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

from .constants import CALIBRATION_BINS, REPORTING_FLOOR
from .digests import digest_mapping, digest_rows

AGGREGATES_VERSION = 1

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
    }
    # Drop empty series rather than emitting a hollow object: a metric that was
    # not computed must be absent, never zero.
    block["comparison"] = {k: v for k, v in block["comparison"].items() if v}
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


def compute_aggregates(
    predictions: pl.DataFrame, thresholds: pl.DataFrame, totals
) -> dict:
    """The versioned aggregates object stored on ``BacktestRun``."""
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
            # Never silently averaged away. Pre-2021 weather describes what the
            # weather actually was, so stronger performance in that era is
            # expected and is not evidence of skill.
            "reanalysisLeakAccepted": True,
            "cutoffAfterKickoffCount": 0,
        },
    }
    if not aggregates["overall"]["thresholds"]:
        del aggregates["overall"]["thresholds"]
    return aggregates


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
    segments: list[tuple[str | None, int | None, str | None, pl.DataFrame]] = [
        (None, None, None, thresholds)
    ]
    for stat in sorted({str(v) for v in thresholds["stat_type"].to_list()}):
        segments.append(
            (stat, None, None, thresholds.filter(pl.col("stat_type") == stat))
        )
    for season in sorted({int(v) for v in thresholds["season"].to_list()}):
        segments.append(
            (None, season, None, thresholds.filter(pl.col("season") == season))
        )
    for era in sorted({str(v) for v in thresholds["weather_era"].to_list()}):
        segments.append(
            (None, None, era, thresholds.filter(pl.col("weather_era") == era))
        )

    for stat, season, era, frame in segments:
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
        bins, sort_keys=["stat_type", "season", "era", "bin_index"]
    )


@dataclass(frozen=True)
class Summary:
    """What a completed run stores, computed in one place."""

    aggregates: dict
    bins: list[dict]
    aggregate_digest: str
    calibration_digest: str


def summarise(predictions: pl.DataFrame, thresholds: pl.DataFrame, totals) -> Summary:
    aggregates = compute_aggregates(predictions, thresholds, totals)
    bins = compute_calibration_bins(thresholds)
    return Summary(
        aggregates=aggregates,
        bins=bins,
        aggregate_digest=aggregate_digest(aggregates),
        calibration_digest=calibration_digest(bins),
    )
