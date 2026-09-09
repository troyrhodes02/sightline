"""Aggregates, calibration bins, and the digests over both.

Everything here is computed from the finished Parquet datasets, never
accumulated as the run goes. That is a determinism requirement rather than a
stylistic one: each metric sorts by a canonical key and reduces with
``math.fsum``, so the result is invariant to chunking, batching, and any future
parallelism. Floating-point addition is not associative, and a metric summed in
arrival order would differ between a run that wrote one part file and a run
that wrote thirty-seven.

Three things this module refuses to do:

* **It will not give a baseline a Brier score.** Both baselines are point
  estimates. Inventing a distribution for one so it could be scored on
  calibration would be a modelling decision this pitch did not scope, and a
  fabricated one would make the comparison meaningless in the flattering
  direction.
* **It will not report one sample size where there are two.** Threshold events
  drawn from a single distribution are correlated, so every bin carries both
  its observation count and the number of projections behind it, and the
  smaller one is the effective sample.
* **It will not omit a metric it did not compute.** An absent key renders as
  "— (not computed)". A zero would be read as a measurement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import polars as pl

from .constants import CALIBRATION_BINS, CONTRACT_LIKE, REPORTING_FLOOR
from .digests import digest_mapping, digest_rows

# v2 adds the `pointEstimates` block (mean and median MAE/RMSE) per SIG-28.
# The `comparison` block is unchanged, so the headline mean-vs-baseline figures
# and the stored calibration curve are byte-identical to v1.
#
# v3 (SIG-70) adds an OPTIONAL `perLayer` block for a simulation run — the
# game-environment and usage-allocation validation MAEs (RD-8) — so a final
# regression localises to a layer. The block is emitted only when the caller
# supplies per-layer metrics (the baseline harness never does), so a baseline
# run's aggregates object is unchanged apart from the version integer. The
# version bump is honest: the *schema* now admits a block a v2 reader would not
# expect, even though a baseline v3 run's content is otherwise byte-identical to
# what a v2 run produced.
AGGREGATES_VERSION = 3

SERIES = (
    ("model", "abs_error", "sq_error"),
    ("seasonAverage", "baseline_season_avg_abs_error", None),
    ("trailingFive", "baseline_trailing5_abs_error", None),
)


def _fsum(values: list[float]) -> float:
    """Sorted, then exactly summed. Invariant to the order rows arrived in."""
    return math.fsum(sorted(values))


def _errors(frame: pl.DataFrame, column: str) -> list[float]:
    if frame.height == 0 or column not in frame.columns:
        return []
    return [v for v in frame[column].to_list() if v is not None]


def _series_metrics(frame: pl.DataFrame, abs_col: str, sq_col: str | None) -> dict:
    absolute = _errors(frame, abs_col)
    if not absolute:
        return {}
    n = len(absolute)
    out = {"mae": _fsum(absolute) / n, "n": n}
    squares = _errors(frame, sq_col) if sq_col else [v * v for v in absolute]
    if squares:
        out["rmse"] = math.sqrt(_fsum(squares) / len(squares))
    return out


def _population_block(comparison: pl.DataFrame, model_only: pl.DataFrame) -> dict:
    block = {
        "comparison": {
            name: _series_metrics(comparison, abs_col, sq_col)
            for name, abs_col, sq_col in SERIES
        },
        "modelOnly": {
            "model": _series_metrics(model_only, "abs_error", "sq_error")
        },
        # Both point estimates over the comparison population (SIG-28). `mean`
        # is the same figure as comparison.model and stays the headline; the
        # median is reported so its accuracy is visible, NOT as a head-to-head
        # against the mean-based baselines, which would not be apples-to-apples.
        "pointEstimates": {
            "mean": _series_metrics(comparison, "abs_error", "sq_error"),
            "median": _series_metrics(comparison, "abs_error_median", "sq_error_median"),
        },
    }
    # Drop empty series rather than emitting a hollow object: a metric that was
    # not computed must be absent, never zero.
    block["comparison"] = {k: v for k, v in block["comparison"].items() if v}
    block["pointEstimates"] = {k: v for k, v in block["pointEstimates"].items() if v}
    return block


def _threshold_block(thresholds: pl.DataFrame) -> dict:
    if thresholds.height == 0:
        return {}
    probabilities = thresholds["probability"].to_list()
    outcomes = [1.0 if o else 0.0 for o in thresholds["outcome"].to_list()]
    squared = [(p - o) ** 2 for p, o in zip(probabilities, outcomes)]
    eps = 1e-12
    log_loss = [
        -(o * math.log(max(p, eps)) + (1 - o) * math.log(max(1 - p, eps)))
        for p, o in zip(probabilities, outcomes)
    ]
    return {
        "brier": _fsum(squared) / len(squared),
        "logLoss": _fsum(log_loss) / len(log_loss),
        "observations": thresholds.height,
        # The effective sample. Threshold events from one distribution are
        # correlated, so the projection count is what a reader should weigh.
        "projections": thresholds["prediction_id"].n_unique(),
    }


def _contract_like_block(predictions: pl.DataFrame, thresholds: pl.DataFrame) -> dict:
    """Error and calibration for the contract-like population (SIG-26).

    The decision-relevant figure the recalibration layer is fitted against, made
    durable and ``verify``-able instead of recomputed ad hoc from Parquet.
    """
    block: dict = {}
    if predictions.height and "contract_like" in predictions.columns:
        cl = predictions.filter(pl.col("contract_like"))
        if cl.height:
            comparison = (
                cl.filter(pl.col("in_comparison_population"))
                if "in_comparison_population" in cl.columns else cl
            )
            block.update(_population_block(comparison, cl))
    if thresholds.height and "contract_like" in thresholds.columns:
        cl_thresholds = thresholds.filter(pl.col("contract_like"))
        threshold_block = _threshold_block(cl_thresholds)
        if threshold_block:
            block["thresholds"] = threshold_block
        # Per-stat-type Brier over the contract-like population — the figure the
        # promotion bar (RD-1) is defined against, made durable per stat so the
        # per-stat baseline comparison reads it from the stored aggregates rather
        # than recomputing from Parquet. Miscalibration is stat-dependent, and a
        # stat type is promoted independently, so the comparison must be per stat.
        by_stat: dict[str, dict] = {}
        if cl_thresholds.height and "stat_type" in cl_thresholds.columns:
            for stat in sorted({str(v) for v in cl_thresholds["stat_type"].to_list()}):
                stat_block = _threshold_block(
                    cl_thresholds.filter(pl.col("stat_type") == stat)
                )
                if stat_block:
                    by_stat[stat] = {"thresholds": stat_block}
        if by_stat:
            block["byStatType"] = by_stat
    return block


def _breakout(frame: pl.DataFrame, comparison: pl.DataFrame, column: str) -> dict:
    out: dict[str, dict] = {}
    if frame.height == 0 or column not in frame.columns:
        return out
    for key in sorted({str(v) for v in frame[column].to_list()}):
        subset = frame.filter(pl.col(column).cast(pl.String) == key)
        subset_comparison = (
            comparison.filter(pl.col(column).cast(pl.String) == key)
            if comparison.height else comparison
        )
        out[key] = _population_block(subset_comparison, subset)
    return out


def _per_layer_block(per_layer: pl.DataFrame | None) -> dict:
    """Layer-1 and Layer-2 validation MAEs, aggregated over the run (RD-8).

    ``per_layer`` is the simulation harness's per-team-game / per-player-game
    validation-metric artefact: one row per (game, layer) carrying the raw
    absolute errors already reduced per game by :mod:`simulation.game_environment`
    and :mod:`simulation.usage_allocation`. We average those per-game MAEs across
    the run so a regression is attributable to ``gameEnvironment`` (plays and
    pass/rush split) or ``usageAllocation`` (target/carry share) rather than
    buried in the final calibration number. A NaN per-game value (usage MAE is
    undefined for a game where nobody recorded an opportunity) is dropped rather
    than averaged in, exactly as the layer metrics themselves refuse to report a
    misleading zero.
    """

    def _mean(column: str) -> tuple[float, int] | None:
        if per_layer is None or per_layer.height == 0 or column not in per_layer.columns:
            return None
        values = [
            v for v in per_layer[column].to_list() if v is not None and not math.isnan(v)
        ]
        if not values:
            return None
        return _fsum(values) / len(values), len(values)

    def _metric(column: str) -> dict | None:
        result = _mean(column)
        if result is None:
            return None
        mae, n = result
        return {"mae": mae, "n": n}

    game_environment = {
        "playsMae": _metric("plays_mae"),
        "passRushSplitMae": _metric("pass_rush_split_mae"),
    }
    usage_allocation = {
        "targetShareMae": _metric("target_share_mae"),
        "carryShareMae": _metric("carry_share_mae"),
    }
    game_environment = {k: v for k, v in game_environment.items() if v is not None}
    usage_allocation = {k: v for k, v in usage_allocation.items() if v is not None}
    block: dict = {}
    if game_environment:
        block["gameEnvironment"] = game_environment
    if usage_allocation:
        block["usageAllocation"] = usage_allocation
    return block


def compute_aggregates(
    predictions: pl.DataFrame, thresholds: pl.DataFrame, totals,
    exclusions: pl.DataFrame | None = None,
    per_layer: pl.DataFrame | None = None,
) -> dict:
    """The versioned aggregates object stored on ``BacktestRun``.

    ``exclusions`` feeds the disclosure counters in ``notes``; ``None`` is
    accepted only so a caller recomputing aggregates from partial artefacts
    can still do so, and yields counters of 0 for the exclusion-derived ones.

    ``per_layer`` is the simulation harness's per-layer validation artefact
    (RD-8); when supplied, a ``perLayer`` block is emitted so a regression
    localises to game-environment or usage-allocation. The baseline harness
    passes ``None`` — it has no such layers — so its aggregates object is
    unchanged apart from ``aggregatesVersion``.
    """
    comparison = (
        predictions.filter(pl.col("in_comparison_population"))
        if predictions.height else predictions
    )
    aggregates = {
        "aggregatesVersion": AGGREGATES_VERSION,
        "population": {
            "candidates": totals.candidates,
            "projected": totals.projected,
            "unprojectable": totals.unprojectable,
            "excluded": totals.excluded,
            "comparison": comparison.height,
            "modelOnly": predictions.height,
        },
        "overall": {
            **_population_block(comparison, predictions),
            "thresholds": _threshold_block(thresholds),
        },
        "byStatType": _breakout(predictions, comparison, "stat_type"),
        "bySeason": _breakout(predictions, comparison, "season"),
        "byEra": _breakout(predictions, comparison, "weather_era"),
        "notes": {
            # contractLike is added below only when non-empty, so a run with no
            # contract-like predictions does not assert a hollow segment.
            # Never silently averaged away. Pre-2021 weather describes what the
            # weather actually was, so stronger performance in that era is
            # expected and is not evidence of skill.
            "reanalysisLeakAccepted": True,
            # Counted from the artefacts, never hardcoded: a stored zero that
            # nothing measures would actively assert the check never fired.
            "cutoffAfterKickoffCount": _reason_count(
                exclusions, "cutoff_after_kickoff"
            ),
            # Predictions graded against a line that carries a correction —
            # the sanctioned exception, disclosed so its size is visible.
            "correctionAppliedCount": _correction_count(predictions),
        },
    }
    if not aggregates["overall"]["thresholds"]:
        del aggregates["overall"]["thresholds"]
    contract_like = _contract_like_block(predictions, thresholds)
    if contract_like:
        aggregates["contractLike"] = contract_like
    per_layer_block = _per_layer_block(per_layer)
    if per_layer_block:
        aggregates["perLayer"] = per_layer_block
    return aggregates


def _reason_count(exclusions: pl.DataFrame | None, reason: str) -> int:
    if exclusions is None or exclusions.height == 0 or "reason" not in exclusions.columns:
        return 0
    return exclusions.filter(pl.col("reason") == reason).height


def _correction_count(predictions: pl.DataFrame) -> int:
    if predictions.height == 0 or "correction_applied" not in predictions.columns:
        return 0
    return predictions.filter(pl.col("correction_applied")).height


def compute_calibration_bins(thresholds: pl.DataFrame) -> list[dict]:
    """Ten fixed bins, per segment, each carrying BOTH sample sizes.

    Segments are single-axis — all, per stat type, per season, per era — which
    is what the partial unique indexes from SIG-13 enforce. Cross-axis slices
    are derived from these artefacts on demand rather than stored, so the
    durable bin count stays proportional to the axes rather than their product.
    """
    if thresholds.height == 0:
        return []

    rows: list[dict] = []
    # (stat_type, season, era, population, frame) — single-axis: at most one of
    # the four segment keys is non-null on any stored bin.
    segments: list[
        tuple[str | None, int | None, str | None, str | None, pl.DataFrame]
    ] = [(None, None, None, None, thresholds)]
    for stat in sorted({str(v) for v in thresholds["stat_type"].to_list()}):
        segments.append(
            (stat, None, None, None, thresholds.filter(pl.col("stat_type") == stat))
        )
    for season in sorted({int(v) for v in thresholds["season"].to_list()}):
        segments.append(
            (None, season, None, None, thresholds.filter(pl.col("season") == season))
        )
    for era in sorted({str(v) for v in thresholds["weather_era"].to_list()}):
        segments.append(
            (None, None, era, None, thresholds.filter(pl.col("weather_era") == era))
        )
    # The contract-like population (SIG-26): the segment the recalibration layer
    # is fitted against. Pooled across stat/season/era, exactly as the other
    # single-axis segments are; cross-axis slices (contract-like within a stat)
    # are derived from the Parquet on demand, never stored.
    if "contract_like" in thresholds.columns:
        contract_like = thresholds.filter(pl.col("contract_like"))
        if contract_like.height:
            segments.append((None, None, None, CONTRACT_LIKE, contract_like))
            # contract-like × stat type — the only stored two-axis segment.
            # Miscalibration is stat-dependent (touchdowns over-project far more
            # than yardage), and the recalibration layer corrects per stat, so
            # the per-stat contract-like curve must be durable, not refitted ad
            # hoc. The migration extends the single-axis CHECK to allow this pair.
            for stat in sorted({str(v) for v in contract_like["stat_type"].to_list()}):
                segments.append(
                    (stat, None, None, CONTRACT_LIKE,
                     contract_like.filter(pl.col("stat_type") == stat))
                )

    for stat, season, era, population, frame in segments:
        for index in range(CALIBRATION_BINS):
            low = index / CALIBRATION_BINS
            high = (index + 1) / CALIBRATION_BINS
            in_bin = frame.filter(
                (pl.col("probability") >= low)
                & (
                    (pl.col("probability") < high)
                    if index < CALIBRATION_BINS - 1
                    else (pl.col("probability") <= high)
                )
            )
            if in_bin.height == 0:
                continue
            probabilities = in_bin["probability"].to_list()
            outcomes = [1.0 if o else 0.0 for o in in_bin["outcome"].to_list()]
            rows.append({
                "stat_type": stat,
                "season": season,
                "era": era,
                "population": population,
                "bin_index": index,
                "bin_low": round(low, 3),
                "bin_high": round(high, 3),
                "predicted_mean": round(_fsum(probabilities) / len(probabilities), 5),
                "observed_rate": round(_fsum(outcomes) / len(outcomes), 5),
                "threshold_observations": in_bin.height,
                "projection_count": in_bin["prediction_id"].n_unique(),
                # Stored and displayed either way. A bin below the floor is
                # never hidden and never contributes to a summary claim.
                "below_floor": in_bin.height < REPORTING_FLOOR,
            })
    return rows


def aggregate_digest(aggregates: dict) -> str:
    return digest_mapping(aggregates)


def calibration_digest(bins: list[dict]) -> str:
    return digest_rows(
        bins, sort_keys=["stat_type", "season", "era", "population", "bin_index"]
    )


@dataclass(frozen=True)
class Summary:
    """What a completed run stores, computed in one place."""

    aggregates: dict
    bins: list[dict]
    aggregate_digest: str
    calibration_digest: str


def summarise(
    predictions: pl.DataFrame, thresholds: pl.DataFrame, totals,
    exclusions: pl.DataFrame | None = None,
    per_layer: pl.DataFrame | None = None,
) -> Summary:
    aggregates = compute_aggregates(
        predictions, thresholds, totals, exclusions, per_layer
    )
    bins = compute_calibration_bins(thresholds)
    return Summary(
        aggregates=aggregates,
        bins=bins,
        aggregate_digest=aggregate_digest(aggregates),
        calibration_digest=calibration_digest(bins),
    )


# --- Baseline comparison and promotion bar (SIG-70, RD-1) -------------------
#
# The promotion bar is the gate a stat type must clear to flip its
# ``ModelSelection`` from the baseline to the simulation engine. It is a PURE
# function of the two runs' measured numbers, deliberately so: promotion is a
# reviewed data change, and the evidence it rests on must be recomputable and
# unarguable rather than a judgement call buried in a script. This module
# computes the bar; it never applies it — nothing here writes ``ModelSelection``.

# RD-1. The three thresholds, named so a change is a visible, reviewed edit
# rather than a magic number in a comparison.
PROMOTION_BRIER_MARGIN = 0.01  # simulation must beat baseline by >= this, absolute
PROMOTION_MIN_GRADED = 500  # over at least this many graded threshold observations
PROMOTION_MIN_SEASONS = 2  # spanning at least this many seasons


def meets_promotion_bar(
    sim_brier: float,
    baseline_brier: float,
    n_graded: int,
    seasons_covered: int,
) -> bool:
    """Whether the simulation engine has earned promotion for a stat type (RD-1).

    All three conditions must hold: the simulation Brier beats the baseline by at
    least :data:`PROMOTION_BRIER_MARGIN` in absolute terms (lower Brier is
    better), the comparison rests on at least :data:`PROMOTION_MIN_GRADED` graded
    predictions, and it spans at least :data:`PROMOTION_MIN_SEASONS` seasons. A
    thinner or shorter comparison does not promote no matter how large the
    margin — a one-season edge is not evidence of a durable one, and 499 graded
    predictions is below the floor the run instruction fixed. The margin is
    ``baseline - sim`` so a *lower* simulation Brier clears the bar.
    """
    beats_by_margin = (baseline_brier - sim_brier) >= PROMOTION_BRIER_MARGIN
    enough_graded = n_graded >= PROMOTION_MIN_GRADED
    enough_seasons = seasons_covered >= PROMOTION_MIN_SEASONS
    return beats_by_margin and enough_graded and enough_seasons


def _stat_type_brier(aggregates: dict, stat_type: str) -> tuple[float, int] | None:
    """The contract-like Brier and its effective sample for one stat type.

    Reads the stored ``contractLike`` per-stat threshold block a run writes for
    the population the recalibration layer is fitted against — the same
    population the promotion bar is defined over (RD-1). Returns ``None`` when the
    run has no contract-like threshold evidence for the stat, which is not a zero:
    a stat with no graded contract-like prediction has no measured Brier, and
    treating its absence as ``0.0`` would flatter a comparison in the most
    dangerous direction.
    """
    contract_like = aggregates.get("contractLike") or {}
    by_stat = contract_like.get("byStatType") or {}
    block = by_stat.get(stat_type) or {}
    thresholds = block.get("thresholds") or {}
    if "brier" not in thresholds:
        return None
    # The effective sample is the projection count, not the observation count:
    # threshold events from one distribution are correlated (metrics docstring).
    n = int(thresholds.get("projections") or 0)
    return float(thresholds["brier"]), n


def compare_stat_type_briers(
    sim_aggregates: dict,
    baseline_aggregates: dict,
    seasons_covered: int,
    *,
    stat_types: list[str] | None = None,
) -> dict[str, dict]:
    """Per-stat-type ``{sim_brier, baseline_brier, delta, n, promotes}`` (RD-1).

    Reads each run's contract-like per-stat Brier (the promotion population) and
    reports, per stat type where BOTH models have a measured Brier, the
    simulation and baseline Briers, the delta (``baseline - sim``, positive when
    simulation is better), the effective graded sample, and whether the
    promotion bar is met given ``seasons_covered``. A stat type where either
    model lacks a measured contract-like Brier is omitted rather than reported
    with a fabricated zero — the comparison is only over stat types both models
    actually predicted in the contract-like population.

    ``seasons_covered`` is a property of the run's span, not of either
    aggregates object, so the caller supplies it (from the run config's
    ``season_from``/``season_to`` or the distinct seasons in the artefacts).
    """
    if stat_types is None:
        sim_stats = set(
            ((sim_aggregates.get("contractLike") or {}).get("byStatType") or {})
        )
        base_stats = set(
            ((baseline_aggregates.get("contractLike") or {}).get("byStatType") or {})
        )
        stat_types = sorted(sim_stats & base_stats)

    out: dict[str, dict] = {}
    for stat_type in stat_types:
        sim = _stat_type_brier(sim_aggregates, stat_type)
        base = _stat_type_brier(baseline_aggregates, stat_type)
        if sim is None or base is None:
            continue
        sim_brier, sim_n = sim
        baseline_brier, base_n = base
        # The effective sample the bar is checked against is the smaller of the
        # two — a stat the simulation graded 900 times but the baseline only 400
        # is a 400-prediction comparison, not a 900-prediction one.
        n = min(sim_n, base_n)
        out[stat_type] = {
            "sim_brier": sim_brier,
            "baseline_brier": baseline_brier,
            "delta": baseline_brier - sim_brier,
            "n": n,
            "promotes": meets_promotion_bar(
                sim_brier, baseline_brier, n, seasons_covered
            ),
        }
    return out
