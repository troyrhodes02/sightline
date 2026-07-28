"""The chronological backtesting harness.

Walks history forward, projects each candidate at a cutoff derived from that
game's own kickoff, grades against the official corrected line, and writes
artefacts. What it is careful about, in order of how badly each would hurt:

* **Nothing sees its own game.** Every read goes through ``AsOfCorpus`` bound
  to the candidate's cutoff, and the candidate universe itself is enumerated
  from pre-cutoff information — enumerating from the target game's own
  participants would condition the population on an outcome.
* **An incomplete run cannot read as a result.** The run row is inserted as
  ``running`` and only moves to ``completed`` after the artefacts are flushed,
  the manifest is written and the marker is placed. A signal writes
  ``interrupted``; an exception writes ``failed``; a process killed
  uncatchably leaves ``running`` forever, which is correct — an abandoned run
  is not a result.
* **Every candidate is accounted for.** Projected, unprojectable, or excluded,
  with a reason code. ``projected + unprojectable + excluded == candidates`` is
  enforced by a CHECK constraint, so a run that loses track of its own
  population cannot be stored as completed.
* **A systematic fault aborts rather than accumulating.** A model declining is
  normal; the harness raising is not, and laundering a thousand crashes into an
  exclusion count would let a broken run look merely selective.
"""

from __future__ import annotations

import json
import signal
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sightline_ingest._version import code_dirty, code_version
from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.db import ConnectionFactory
from sightline_ingest.errors import sanitize_error
from sightline_ingest.grading import GradingCorpus

from . import artifacts as art
from .baselines import REASON_BASELINE_UNAVAILABLE, compute as compute_baselines
from .constants import (
    ARCHIVED_FORECAST_FROM_SEASON,
    CUTOFF_MINUTES_BEFORE_KICKOFF,
    CUTOFF_POLICY,
    CUTOFF_SCHEDULE_LOOKBACK_DAYS,
    GRADING_TARGET,
    MODEL_VERSION,
    THRESHOLD_POLICY_VERSION,
    engine_config,
)
from .digests import corpus_digest, digest_mapping, digest_rows
from .metrics import AGGREGATES_VERSION, summarise
from .features import assemble_batch
from .priors import InsufficientPriorEvidence, Prior, fit_prior
from .projection import ProjectionResult, Unprojectable
from .projection import project_one
from .stat_types import names as stat_type_names
from .stat_types import sort_key as stat_sort_key
from .stat_types import spec

MAX_CANDIDATE_ERRORS = 100

REASON_NO_ACTUAL = "no_actual_stat_line"
REASON_CUTOFF_AFTER_KICKOFF = "cutoff_after_kickoff"
REASON_NO_PRIOR = "no_prior_evidence"
REASON_HARNESS_ERROR = "harness_error"

STAGE_ENGINE = "engine"
STAGE_HARNESS = "harness"


class HarnessAborted(RuntimeError):
    """Too many per-candidate failures; a systematic fault, not selectivity."""


@dataclass(frozen=True)
class RunConfig:
    season_from: int
    season_to: int
    stat_types: tuple[str, ...]
    season_types: tuple[str, ...] = ("REG",)
    evaluation_window: str = "development"
    label: str | None = None
    seed: int = 20260728
    limit_games: int | None = None
    artifact_base: Path | None = None

    def as_dict(self) -> dict:
        return {
            "seasonFrom": self.season_from,
            "seasonTo": self.season_to,
            "statTypes": list(self.stat_types),
            "seasonTypes": list(self.season_types),
            "evaluationWindow": self.evaluation_window,
            "seed": self.seed,
            # A truncated run is a different experiment from a full one over
            # the same seasons. Without this in the manifest, the difference
            # would have no stored evidence and a digest mismatch against the
            # full run would read as a determinism break.
            "limitGames": self.limit_games,
        }


@dataclass
class RunTotals:
    candidates: int = 0
    projected: int = 0
    unprojectable: int = 0
    excluded: int = 0
    comparison: int = 0
    threshold_observations: int = 0
    harness_errors: int = 0


@dataclass
class RunOutcome:
    run_id: str
    status: str
    totals: RunTotals
    root: Path
    predictions_digest: str | None = None
    error: str | None = None
    counts: dict[str, int] = field(default_factory=dict)
    aggregate_digest: str | None = None
    calibration_digest: str | None = None


# --- Cutoff -----------------------------------------------------------------


def derive_cutoff(corpus_at_lookback: AsOfCorpus, *, game_id: str, kickoff: datetime):
    """``min(actual kickoff, kickoff known a week out) - 90 minutes``.

    ``min`` is deliberate. For a cutoff, resolving EARLIER is the conservative
    direction — the mirror image of ``known_at``, where resolving later is
    conservative. A game flexed later must not hand the model an extra window
    it would not have had; a game flexed earlier must not push the cutoff past
    its own kickoff.
    """
    known = corpus_at_lookback.schedule_as_known(game_id=game_id)
    candidates = [kickoff]
    if known.height:
        candidates.append(known["kickoff_at"][0])
    return min(candidates) - timedelta(minutes=CUTOFF_MINUTES_BEFORE_KICKOFF)


def weather_era(corpus: AsOfCorpus, *, game_id: str, season: int) -> tuple[str, str]:
    """``(era, era_source)`` — from the weather row if visible, else the season."""
    frame = corpus.game_weather(game_id=game_id)
    if frame.height and frame["era"][0] is not None:
        return str(frame["era"][0]), "weather_row"
    era = (
        "archived_forecast"
        if season >= ARCHIVED_FORECAST_FROM_SEASON
        else "reanalysis"
    )
    return era, "season_rule"


# --- Run --------------------------------------------------------------------


def run_backtest(
    connect: ConnectionFactory,
    config: RunConfig,
    *,
    persist,
    now: datetime | None = None,
) -> RunOutcome:
    """Execute one backtest end to end. ``persist`` is the run-record writer."""
    started = now or datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    base = config.artifact_base or art.default_artifact_base()

    sha, dirty = code_version(), code_dirty()
    engine_cfg = engine_config()
    run_id = persist.insert_run(
        connect,
        config=config,
        model_version=MODEL_VERSION,
        code_version=sha,
        code_dirty=dirty,
        engine_config=engine_cfg,
        engine_config_digest=digest_mapping(engine_cfg),
        corpus_digest=corpus_digest(connect),
        cutoff_policy=CUTOFF_POLICY,
        threshold_policy_version=THRESHOLD_POLICY_VERSION,
        grading_target=GRADING_TARGET,
        artifact_path=str(art.run_root(base, "pending")),
        started_at=started,
    )
    root = art.run_root(base, run_id)
    writer = art.ArtifactWriter(root=root)
    persist.set_artifact_path(connect, run_id, str(root))

    totals = RunTotals()
    interrupted = {"flag": False}

    def _on_signal(signum, frame):  # pragma: no cover - exercised via raise
        interrupted["flag"] = True

    previous = {}
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            previous[sig] = signal.signal(sig, _on_signal)
        except (ValueError, OSError):
            # Not on the main thread (pytest -n, some CI runners). The run is
            # still correct; it simply cannot be interrupted gracefully.
            pass

    try:
        _execute(connect, config, writer, totals, interrupted, started)
        if interrupted["flag"]:
            counts = writer.flush()
            persist.finish_run(
                connect, run_id, status="interrupted", totals=totals,
                finished_at=_now(), error="interrupted by signal",
            )
            return RunOutcome(run_id, "interrupted", totals, root, counts=counts)

        # Completion order is normative and each step depends on the last:
        # flush the datasets, summarise them, write the run row (which the
        # CHECK constraints will refuse without all three digests), then the
        # manifest, then the marker. A reader that finds the marker is looking
        # at a run whose row is already `completed`.
        counts = writer.flush()
        predictions_digest = digest_rows(
            writer.rows(art.PREDICTIONS),
            sort_keys=["game_id", "player_id", "stat_type"],
        )
        summary = summarise(
            art.read_dataset(root, art.PREDICTIONS),
            art.read_dataset(root, art.THRESHOLDS),
            totals,
            art.read_dataset(root, art.EXCLUSIONS),
        )
        persist.complete_run(
            connect, run_id, totals=totals, aggregates=summary.aggregates,
            aggregates_version=AGGREGATES_VERSION, bins=summary.bins,
            predictions_digest=predictions_digest,
            aggregate_digest=summary.aggregate_digest,
            calibration_digest=summary.calibration_digest,
            finished_at=_now(),
        )
        writer.write_manifest(
            {
                "runId": run_id,
                "config": config.as_dict(),
                "modelVersion": MODEL_VERSION,
                "codeVersion": sha,
                "cutoffPolicy": CUTOFF_POLICY,
                "thresholdPolicyVersion": THRESHOLD_POLICY_VERSION,
                "gradingTarget": GRADING_TARGET,
                "engineConfig": engine_cfg,
                "counts": counts,
                "totals": totals.__dict__,
                "predictionsDigest": predictions_digest,
                "aggregateDigest": summary.aggregate_digest,
                "calibrationDigest": summary.calibration_digest,
            }
        )
        # The marker goes last. See artifacts.py.
        writer.mark_complete()
        return RunOutcome(
            run_id, "completed", totals, root, predictions_digest,
            counts=counts,
            aggregate_digest=summary.aggregate_digest,
            calibration_digest=summary.calibration_digest,
        )
    except BaseException as exc:  # noqa: BLE001 - recorded, not re-raised
        # The flush is best-effort: the likeliest cause of a mid-run failure
        # is the disk, in which case flushing raises again and would mask the
        # original error AND skip the status write, leaving the run `running`
        # with no error message — the reaper would later record "abandoned"
        # instead of the actual cause.
        try:
            writer.flush()
        except Exception:  # noqa: BLE001 - the original exc is the record
            pass
        persist.finish_run(
            connect, run_id, status="failed", totals=totals,
            finished_at=_now(), error=sanitize_error(exc),
        )
        return RunOutcome(run_id, "failed", totals, root, error=sanitize_error(exc))
    finally:
        for sig, handler in previous.items():
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _execute(connect, config, writer, totals, interrupted, started) -> None:
    grading = GradingCorpus(connect)
    games = _games_in_scope(connect, config)
    seasons_by_game = {g["id"]: g["season"] for g in games}
    prior_cache: dict[tuple[int, str, str], Prior | None] = {}

    for game in games:
        if interrupted["flag"]:
            return
        kickoff = game["kickoff_at"]
        lookback = AsOfCorpus(
            connect, kickoff - timedelta(days=CUTOFF_SCHEDULE_LOOKBACK_DAYS)
        )
        cutoff = derive_cutoff(lookback, game_id=game["id"], kickoff=kickoff)
        corpus = AsOfCorpus(connect, cutoff)
        era, era_source = weather_era(
            corpus, game_id=game["id"], season=game["season"]
        )
        actuals = _actuals_for_game(grading, game["id"])

        for stat_name in sorted(config.stat_types, key=stat_sort_key):
            if interrupted["flag"]:
                return
            _run_stat_type(
                connect, corpus, writer, totals, prior_cache, seasons_by_game,
                game=game, stat_name=stat_name, cutoff=cutoff, kickoff=kickoff,
                era=era, era_source=era_source, actuals=actuals, started=started,
            )


def _run_stat_type(
    connect, corpus, writer, totals, prior_cache, seasons_by_game, *,
    game, stat_name, cutoff, kickoff, era, era_source, actuals, started,
) -> None:
    stat = spec(stat_name)
    if cutoff >= kickoff:
        # Should never happen; counted and excluded rather than projected.
        writer.append(art.EXCLUSIONS, _exclusion(
            game["id"], None, stat_name, STAGE_HARNESS,
            REASON_CUTOFF_AFTER_KICKOFF, "cutoff at or after kickoff",
        ))
        totals.candidates += 1
        totals.excluded += 1
        return

    # Current season and the one before it: in week 1 nothing has published
    # this season yet, and a candidate universe that is empty produces no
    # exclusions either — a coverage gap nobody would notice.
    participants = corpus.season_participants(
        seasons=(game["season"] - 1, game["season"]), column=stat.column
    )
    if participants.height == 0:
        return
    positions = {
        row["player_id"]: row["position"] for row in participants.to_dicts()
    }
    player_ids = sorted(positions)

    histories = assemble_batch(
        corpus, player_ids=player_ids, game_id=game["id"], spec=stat,
        seasons_by_game=seasons_by_game,
    )

    teams = {game["home_abbr"], game["away_abbr"]}
    for player_id in player_ids:
        history = histories[player_id]
        # Candidate iff the player was, as of the cutoff, playing for one of
        # the two teams in this game. Their last eligible game's team is
        # pre-cutoff information; the roster today is not.
        if not history.values:
            continue
        last_team = history.last_team
        if last_team is not None and last_team not in teams:
            continue

        totals.candidates += 1
        try:
            _project_candidate(
                corpus, writer, totals, prior_cache, positions,
                game=game, stat=stat, player_id=player_id, history=history,
                cutoff=cutoff, kickoff=kickoff, era=era, era_source=era_source,
                actuals=actuals, started=started,
            )
        except Exception as exc:  # noqa: BLE001 - recorded per candidate
            totals.harness_errors += 1
            totals.excluded += 1
            writer.append(art.EXCLUSIONS, _exclusion(
                game["id"], player_id, stat.name, STAGE_HARNESS,
                REASON_HARNESS_ERROR, type(exc).__name__,
            ))
            if totals.harness_errors >= MAX_CANDIDATE_ERRORS:
                raise HarnessAborted(
                    f"{totals.harness_errors} candidate failures; aborting rather "
                    "than laundering a systematic fault into an exclusion count"
                ) from exc


def _project_candidate(
    corpus, writer, totals, prior_cache, positions, *,
    game, stat, player_id, history, cutoff, kickoff, era, era_source,
    actuals, started,
) -> None:
    position = positions.get(player_id) or "UNK"
    prior = _prior_for(corpus, writer, prior_cache, game["season"], stat, position)
    if prior is None:
        totals.excluded += 1
        writer.append(art.EXCLUSIONS, _exclusion(
            game["id"], player_id, stat.name, STAGE_HARNESS, REASON_NO_PRIOR,
            f"no pre-{game['season']} evidence for {stat.name}/{position}",
        ))
        return

    result = project_one(
        history, prior=prior, spec=stat, game_id=game["id"], kickoff=kickoff,
        information_cutoff=cutoff, computed_at=started,
    )
    if isinstance(result, Unprojectable):
        totals.unprojectable += 1
        writer.append(art.EXCLUSIONS, _exclusion(
            game["id"], player_id, stat.name, STAGE_ENGINE, result.reason, None,
        ))
        return

    actual_row = actuals.get(player_id, {})
    actual = actual_row.get(stat.column)
    # Grading against the corrected line is a sanctioned exception, and the
    # disclosure travels with it: ingest bumps `version` on every correction,
    # so version > 1 means this actual differs (or may differ) from the line
    # first published. Surfaced per prediction and counted in the aggregates.
    correction_applied = int(actual_row.get("version") or 1) > 1
    if actual is None:
        totals.excluded += 1
        writer.append(art.EXCLUSIONS, _exclusion(
            game["id"], player_id, stat.name, STAGE_HARNESS, REASON_NO_ACTUAL, None,
        ))
        return

    baselines = compute_baselines(history, season=game["season"])
    in_comparison = baselines.both_defined
    if in_comparison:
        totals.comparison += 1
    else:
        writer.append(art.EXCLUSIONS, _exclusion(
            game["id"], player_id, stat.name, STAGE_HARNESS,
            REASON_BASELINE_UNAVAILABLE,
            "season average undefined before the player's first eligible game",
            prediction_id=_prediction_id(game["id"], player_id, stat.name, cutoff),
        ))

    totals.projected += 1
    writer.append(
        art.PREDICTIONS,
        _prediction_row(
            result, game=game, stat=stat, actual=float(actual),
            baselines=baselines, in_comparison=in_comparison, era=era,
            era_source=era_source, position=position, kickoff=kickoff,
            correction_applied=correction_applied,
        ),
    )
    for threshold in stat.thresholds:
        totals.threshold_observations += 1
        writer.append(art.THRESHOLDS, {
            "prediction_id": _prediction_id(game["id"], player_id, stat.name, cutoff),
            "stat_type": stat.name,
            "season": game["season"],
            "weather_era": era,
            "threshold": float(threshold),
            "probability": result.prob_at_least(threshold),
            "outcome": bool(float(actual) >= threshold),
        })


def _prior_for(corpus, writer, cache, season, stat, position) -> Prior | None:
    key = (season, stat.name, position)
    if key in cache:
        return cache[key]
    frame = corpus.population_stats(
        before_season=season, position=position, column=stat.column
    )
    rows = frame.to_dicts() if frame.height else []
    try:
        prior = fit_prior(rows, season=season, spec=stat, position=position)
    except InsufficientPriorEvidence:
        prior = None
    cache[key] = prior
    if prior is not None:
        # One row per prior the run actually used, written on first fit, so
        # a run's priors are reproducible without re-fitting and inspectable
        # without re-running (spec: priors/ artefact).
        writer.append(art.PRIORS, {
            "season": prior.season,
            "stat_type": prior.stat_type,
            "position": prior.position,
            "fitted_from_seasons": json.dumps(list(prior.fitted_from_seasons)),
            "sample_games": prior.sample_games,
            "sample_players": prior.sample_players,
            "p_zero": prior.p_zero,
            "mu": prior.mu,
            "sigma": prior.sigma,
            "mean": prior.mean,
            "variance": prior.variance,
        })
    return prior


def _prediction_id(
    game_id: str, player_id: str, stat_type: str, information_cutoff: datetime
) -> str:
    from .digests import digest_strings

    # The cutoff is part of the identity (spec: prediction_id digest recipe).
    # A schedule flex changes the cutoff, the visible corpus, and potentially
    # the projection — two materially different predictions must not share an
    # id across runs.
    return digest_strings(
        [game_id, player_id, stat_type, MODEL_VERSION,
         information_cutoff.isoformat()]
    )[:32]


def _prediction_row(result, *, game, stat, actual, baselines, in_comparison,
                    era, era_source, position, kickoff,
                    correction_applied) -> dict:
    error = actual - result.projected_value
    cohorts = list(result.cohorts)
    percentile = _percentile(result, actual)
    row = {
        "prediction_id": _prediction_id(
            game["id"], result.player_id, stat.name, result.information_cutoff
        ),
        "game_id": game["id"],
        "player_id": result.player_id,
        "season": game["season"],
        "week": game["week"],
        "season_type": game["season_type"],
        "stat_type": stat.name,
        "position": position,
        "model_version": result.model_version,
        "distribution_kind": result.distribution_kind,
        "params": json.dumps(result.params, sort_keys=True),
        "pmf": json.dumps(result.pmf) if result.pmf else None,
        "tail_mass": result.tail_mass,
        "zero_mass": result.zero_mass,
        **result.quantiles,
        "projected_value": result.projected_value,
        "interval_low": result.interval_low,
        "interval_high": result.interval_high,
        "mass_below_zero": result.mass_below_zero,
        "confidence": result.confidence,
        "n_eff": result.n_eff,
        "relative_width": result.relative_width,
        "drivers": json.dumps(result.drivers),
        "information_cutoff": result.information_cutoff,
        "kickoff_at": kickoff,
        "computed_at": result.computed_at,
        "weather_era": era,
        "era_source": era_source,
        "actual": actual,
        "actual_percentile": percentile,
        "abs_error": abs(error),
        "sq_error": error * error,
        "baseline_season_avg": baselines.season_average,
        "baseline_trailing5": baselines.trailing_five,
        "baseline_season_avg_abs_error": (
            abs(actual - baselines.season_average)
            if baselines.season_average is not None else None
        ),
        "baseline_trailing5_abs_error": (
            abs(actual - baselines.trailing_five)
            if baselines.trailing_five is not None else None
        ),
        "in_comparison_population": in_comparison,
        "correction_applied": correction_applied,
        "cohorts": json.dumps(sorted(cohorts)),
    }
    return row


def _percentile(result: ProjectionResult, actual: float) -> float:
    """Where the outcome fell in the predicted distribution.

    What makes a miss interpretable: p97 is a tail event, while p50 with a
    large error means the spread is wrong rather than the location.
    """
    return round(1.0 - result.prob_at_least(actual + 1e-9), 4)


def _exclusion(game_id, player_id, stat_type, stage, reason, detail,
               prediction_id=None) -> dict:
    return {
        "game_id": game_id,
        "player_id": player_id,
        "stat_type": stat_type,
        "stage": stage,
        "reason": reason,
        "detail": detail,
        "prediction_id": prediction_id,
    }


def _actuals_for_game(grading: GradingCorpus, game_id: str) -> dict[str, dict]:
    frame = grading.final_player_stats_for_game(game_id=game_id)
    if frame.height == 0:
        return {}
    return {row["player_id"]: row for row in frame.to_dicts()}


def _games_in_scope(connect, config: RunConfig) -> list[dict]:
    """Chronological, with an id tiebreaker.

    Kickoff times collide constantly — every 1:00pm Sunday game shares one —
    so ordering by kickoff alone is not a total order and the run's iteration
    order would depend on the planner.
    """
    sql = """
        select g.id, g.season, g.week, g.season_type, g.kickoff_at,
               ht.nflverse_abbr as home_abbr, at.nflverse_abbr as away_abbr
        from games g
        join teams ht on ht.id = g.home_team_id
        join teams at on at.id = g.away_team_id
        where g.season between %(from)s and %(to)s
          and g.season_type = any(%(types)s::text[])
        order by g.kickoff_at, g.id
    """
    params = {
        "from": config.season_from,
        "to": config.season_to,
        "types": list(config.season_types),
    }
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    if config.limit_games is not None:
        rows = rows[: config.limit_games]
    return rows


def validate_stat_types(values: list[str]) -> tuple[str, ...]:
    registered = set(stat_type_names())
    unknown = [v for v in values if v not in registered]
    if unknown:
        raise ValueError(
            f"unknown stat type(s): {', '.join(unknown)}; "
            f"registered: {', '.join(stat_type_names())}"
        )
    return tuple(values)
