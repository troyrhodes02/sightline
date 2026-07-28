"""The inspection commands: show, calibration, predictions, explain, exclusions,
thresholds.

These replace the Temporary Backtest Inspection UI, which the owner withdrew on
2026-07-28. Every requirement that surface carried is here as a command, and
each is read-only: nothing in this module writes, mutates, or deletes anything,
including artefacts.

They read stored aggregates and stored artefacts. The one exception is
``explain``'s eligible-source and excluded-by-cutoff panels, which perform a
live diagnostic read bounded by the prediction's own stored cutoff — labelled
as a diagnostic in the output, and asserted by test to leave every digest
unchanged.
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl

from . import artifacts as art
from . import diagnostics, persist, report
from .baselines import REASON_BASELINE_UNAVAILABLE
from .constants import REPORTING_FLOOR
from .distributions import NegativeBinomial, ZeroInflatedLogNormal
from .projection import (
    COHORT_IMPOSSIBLE,
    COHORT_LOW_CONFIDENCE,
    COHORT_RETURNING,
    COHORT_ROLE_CHANGE,
    COHORT_SPARSE,
)
from .stat_types import spec

# The cohort vocabulary is exactly what the engine emits — the COHORT_*
# constants in projection.py are the single source of truth, and this tuple
# only collects them so the CLI can validate --cohort and list the options.
# Never retype the strings here.
COHORTS = (
    COHORT_SPARSE,
    COHORT_LOW_CONFIDENCE,
    COHORT_RETURNING,
    COHORT_ROLE_CHANGE,
    COHORT_IMPOSSIBLE,
)


class RunNotFound(LookupError):
    pass


class NotAResult(RuntimeError):
    """The run exists but is not `completed`; --strict turns this into exit 1."""


def load(connect, run_id: str) -> dict:
    run = persist.load_run(connect, run_id)
    if run is None:
        raise RunNotFound(f"no run with id {run_id!r}")
    return run


def _predictions(run: dict) -> pl.DataFrame:
    return art.read_dataset(Path(run["artifact_path"]), art.PREDICTIONS)


# --- show --------------------------------------------------------------------


# Counters `show` always accounts for, present or not. Stored in
# aggregates["notes"] by the harness; an older run that predates a counter
# renders "— (not recorded)" rather than failing or showing a zero.
_DISCLOSURE_KEYS = ("correctionAppliedCount", "cutoffAfterKickoffCount")


def _disclosure_lines(aggregates: dict | None) -> list[str]:
    notes = (aggregates or {}).get("notes") or {}
    return ["", *(report.disclosure_line(key, notes) for key in _DISCLOSURE_KEYS)]


def show(connect, run_id: str, *, breakout: str = "total") -> tuple[str, bool]:
    run = load(connect, run_id)
    lines = [report.manifest_block(run), ""]
    lines += report.status_band(run)
    lines.append(report.population_block(run))
    lines.append("")

    aggregates = run["aggregates"]
    if not aggregates:
        lines.append(
            "No aggregates stored. This run produced no evaluable predictions, "
            "so there is nothing to compare."
        )
        lines += _disclosure_lines(aggregates)
        return "\n".join(lines), run["status"] == "completed"

    if breakout == "total":
        lines.append(report.metrics_table(aggregates.get("overall", {}), "total"))
    else:
        key = {"stat": "byStatType", "season": "bySeason", "era": "byEra"}[breakout]
        segments = aggregates.get(key, {})
        if not segments:
            lines.append(f"no {breakout} breakout stored")
        for name in sorted(segments):
            lines.append(report.metrics_table(segments[name], name))
            lines.append("")
        if breakout == "era" and "reanalysis" in segments:
            lines.append(report.ERA_NOTE)

    lines.append("")
    lines.append(report.thresholds_block(aggregates))
    lines += _disclosure_lines(aggregates)
    return "\n".join(lines), run["status"] == "completed"


def show_data(connect, run_id: str) -> tuple[dict, bool]:
    """The machine-readable form of ``show``: the stored run row, verbatim.

    The aggregates blob (including its ``notes`` disclosure counters, when
    the harness recorded them) rides along unmodified, so the JSON carries
    everything the text rendering shows across every breakout.
    """
    run = load(connect, run_id)
    return dict(run), run["status"] == "completed"


# --- calibration --------------------------------------------------------------


def _segment_bins(
    connect, run_id: str, *, stat: str | None, era: str | None
) -> list[dict]:
    """The stored bins for one single-axis segment. Shared by text and JSON."""
    return [
        b for b in persist.load_calibration_bins(connect, run_id)
        if b["stat_type"] == stat and b["era"] == era and b["season"] is None
    ]


def calibration(
    connect, run_id: str, *, stat: str | None = None, era: str | None = None
) -> tuple[str, bool]:
    run = load(connect, run_id)
    bins = _segment_bins(connect, run_id, stat=stat, era=era)
    lines = report.status_band(run)
    lines.append(
        f"threshold policy: {run['threshold_policy_version']} · "
        f"reporting floor {REPORTING_FLOOR:,} threshold observations"
    )
    segment = ", ".join(
        part for part in (stat and f"stat={stat}", era and f"era={era}") if part
    )
    lines.append(f"segment: {segment or 'all'}")
    lines.append("")
    if not bins:
        lines.append(
            "No calibration bins for this segment. Cross-axis slices are derived "
            "from the artefacts on demand and are not persisted."
        )
        return "\n".join(lines), run["status"] == "completed"

    lines.append(report.calibration_table(bins))
    lines.append("")
    lines.append(report.calibration_summary(bins, REPORTING_FLOOR))
    return "\n".join(lines), run["status"] == "completed"


def calibration_data(
    connect, run_id: str, *, stat: str | None = None, era: str | None = None
) -> tuple[dict, bool]:
    run = load(connect, run_id)
    bins = _segment_bins(connect, run_id, stat=stat, era=era)
    payload = {
        "runId": run["id"],
        "status": run["status"],
        "thresholdPolicy": run["threshold_policy_version"],
        "reportingFloor": REPORTING_FLOOR,
        "segment": {"stat": stat, "era": era},
        "bins": bins,
    }
    return payload, run["status"] == "completed"


# --- predictions ---------------------------------------------------------------


def _filter_predictions(
    frame: pl.DataFrame, *, cohort: str | None, player: str | None,
    sort: str, limit: int,
) -> tuple[pl.DataFrame, int]:
    """Filter, sort, bound. Returns (bounded frame, matching count).

    The cohort filter is a membership test against the JSON-encoded cohort
    list; the CLI validates the value against ``COHORTS`` before it gets
    here, so an unknown cohort is a usage error rather than an empty result.
    The player filter is an exact id match.
    """
    if cohort:
        frame = frame.filter(pl.col("cohorts").str.contains(cohort))
    if player:
        frame = frame.filter(pl.col("player_id") == player)
    filtered = frame.height
    sort_column = {"err": "abs_error", "proj": "projected_value",
                   "wk": "week", "n": "n_eff"}.get(sort, "abs_error")
    return frame.sort(sort_column, descending=True).head(limit), filtered


def predictions(
    connect, run_id: str, *, cohort: str | None = None, player: str | None = None,
    sort: str = "err", limit: int = 50,
) -> tuple[str, bool]:
    run = load(connect, run_id)
    full = _predictions(run)
    total = full.height
    lines = report.status_band(run)

    if total == 0:
        lines.append("No predictions were produced. There is nothing to inspect.")
        return "\n".join(lines), run["status"] == "completed"

    frame, filtered = _filter_predictions(
        full, cohort=cohort, player=player, sort=sort, limit=limit
    )
    if filtered == 0:
        lines.append(
            f"No predictions match. {total:,} in this run. "
            "Clear the filters to see them."
        )
        return "\n".join(lines), run["status"] == "completed"

    lines.append(report.sample_disclosure(frame.height, total, filtered=filtered))
    lines.append("")
    lines.append(report.table(
        ["prediction", "player", "wk", "stat", "proj", "range", "conf", "actual",
         "err"],
        [
            [
                row["prediction_id"][:10],
                row["player_id"][:8],
                f"{str(row['season'])[2:]}w{row['week']:02d}",
                row["stat_type"],
                f"{row['projected_value']:.1f}",
                f"{row['interval_low']:.0f}-{row['interval_high']:.0f}",
                row["confidence"] + (" ⚠" if row["confidence"] == "low" else ""),
                f"{row['actual']:.1f}",
                f"{'+' if row['actual'] >= row['projected_value'] else '−'}"
                f"{row['abs_error']:.1f}",
            ]
            for row in frame.to_dicts()
        ],
    ))
    return "\n".join(lines), run["status"] == "completed"


def predictions_data(
    connect, run_id: str, *, cohort: str | None = None, player: str | None = None,
    sort: str = "err", limit: int = 50,
) -> tuple[dict, bool]:
    run = load(connect, run_id)
    full = _predictions(run)
    frame, filtered = _filter_predictions(
        full, cohort=cohort, player=player, sort=sort, limit=limit
    )
    payload = {
        "runId": run["id"],
        "status": run["status"],
        "total": full.height,
        "filtered": filtered,
        "shown": frame.height,
        "predictions": frame.to_dicts(),
    }
    return payload, run["status"] == "completed"


# --- explain -------------------------------------------------------------------


def _rehydrate(row: dict):
    params = json.loads(row["params"])
    if row["distribution_kind"] == ZeroInflatedLogNormal.kind:
        return ZeroInflatedLogNormal(**params)
    pmf = json.loads(row["pmf"]) if row["pmf"] else []
    return NegativeBinomial(**params, cap=max(len(pmf) - 1, 1))


def _prediction_row(run: dict, run_id: str, prediction_id: str) -> dict:
    frame = _predictions(run).filter(pl.col("prediction_id") == prediction_id)
    if frame.height == 0:
        raise RunNotFound(f"no prediction {prediction_id!r} in run {run_id}")
    return frame.to_dicts()[0]


def _explain_payload(connect, run: dict, run_id: str, prediction_id: str) -> dict:
    """Everything ``explain`` shows, as data. Shared by the text and JSON paths
    so the two renderings can never drift apart on what was read."""
    row = _prediction_row(run, run_id, prediction_id)
    distribution = _rehydrate(row)
    stat = spec(row["stat_type"])
    sources = diagnostics.eligible_sources(
        connect, player_id=row["player_id"], game_id=row["game_id"],
        cutoff=row["information_cutoff"],
    )
    excluded = diagnostics.excluded_by_cutoff(
        connect, player_id=row["player_id"], game_id=row["game_id"],
        cutoff=row["information_cutoff"],
    )
    return {
        "row": row,
        "drivers": json.loads(row["drivers"]),
        "gridThresholds": [
            {"threshold": t, "probAtLeast": distribution.prob_at_least(t)}
            for t in stat.thresholds
        ],
        "cutoffAtOrAfterKickoff": row["information_cutoff"] >= row["kickoff_at"],
        "eligibleSources": sources,
        "excludedByCutoff": excluded,
    }


def explain(connect, run_id: str, prediction_id: str) -> tuple[str, bool]:
    run = load(connect, run_id)
    payload = _explain_payload(connect, run, run_id, prediction_id)
    row = payload["row"]

    lines = report.status_band(run)
    lines.append(
        f"{row['player_id']} · {row['stat_type']} · {row['season']} "
        f"wk{row['week']:02d}"
    )
    lines.append(
        f"model {row['model_version']} · confidence {row['confidence'].upper()}"
        f"{' ⚠' if row['confidence'] == 'low' else ''} · era {row['weather_era']} "
        f"({row['era_source']})"
    )

    lines.append("")
    lines.append("DISTRIBUTION")
    lines.append(
        f"  projected {row['projected_value']:.1f} · range "
        f"{row['interval_low']:.1f}-{row['interval_high']:.1f} (p10-p90) · "
        f"kind {row['distribution_kind']}"
    )
    quantiles = " ".join(
        f"{k}={row[k]:.1f}" for k in ("q05", "q10", "q25", "q50", "q75", "q90", "q95")
        if k in row
    )
    lines.append(f"  {quantiles}")
    lines.append(
        f"  mass below zero {row['mass_below_zero']:.6f} · "
        f"n_eff {row['n_eff']} · relative width {row['relative_width']:.3f}"
    )
    if row["zero_mass"] is not None:
        lines.append(f"  zero mass {row['zero_mass']:.4f} · "
                     f"tail mass {row['tail_mass']:.6f}")
    lines.append(
        f"  actual {row['actual']:.1f} ← p{int(row['actual_percentile'] * 100):02d}"
    )

    lines.append("")
    lines.append("THRESHOLDS (from the stored parameters, no refit)")
    lines.append("  " + "   ".join(
        f"≥{entry['threshold']:>6.1f} {entry['probAtLeast']:.3f}"
        for entry in payload["gridThresholds"]
    ))

    lines.append("")
    lines.append("TEMPORAL")
    lines.append(f"  kickoff             {row['kickoff_at']}")
    lines.append(f"  information cutoff  {row['information_cutoff']}")
    lines.append(f"  computed at         {row['computed_at']}")
    if payload["cutoffAtOrAfterKickoff"]:
        lines.append("  !! CUTOFF AT OR AFTER KICKOFF — this projection could see "
                     "the game it predicts.")

    lines.append("")
    lines.append("DRIVERS")
    for driver in payload["drivers"]:
        lines.append(f"  · {driver}")

    lines.append("")
    lines.append("ELIGIBLE SOURCE RECORDS (live diagnostic read at the stored cutoff)")
    sources = payload["eligibleSources"]
    if sources:
        lines.append(report.table(
            ["source", "value", "known_at", "flag"],
            [[s["source"], str(s["value"]), str(s["known_at"]),
              "RECONSTRUCTED" if s["reconstructed"] else "OBSERVED"]
             for s in sources],
        ))
    else:
        lines.append("  none visible at the cutoff")

    lines.append("")
    excluded = payload["excludedByCutoff"]
    lines.append(
        f"EXCLUDED BY CUTOFF — {len(excluded)} record(s) that existed and were "
        "unreachable"
    )
    if excluded:
        lines.append(report.table(
            ["kind", "detail", "known_at"],
            [[e["kind"], e["detail"], str(e["known_at"])] for e in excluded],
        ))
        lines.append("  These rows exist in the corpus and were structurally "
                     "unreachable at the cutoff above.")
        lines.append("  Their presence here is the point.")
    else:
        lines.append("  no future-dated records for this player")

    return "\n".join(lines), run["status"] == "completed"


def explain_data(connect, run_id: str, prediction_id: str) -> tuple[dict, bool]:
    run = load(connect, run_id)
    payload = _explain_payload(connect, run, run_id, prediction_id)
    payload = {"runId": run["id"], "status": run["status"], **payload}
    return payload, run["status"] == "completed"


# --- exclusions ----------------------------------------------------------------


def exclusion_breakdown(frame: pl.DataFrame, candidate_count: int) -> dict:
    """Counts by reason, with the headline arithmetic done honestly.

    ``baseline_unavailable`` rows are not removals from the evaluation: those
    candidates WERE projected and graded, and are only absent from the
    baseline-comparison population (they remain in model-only). Counting them
    in the "not in the evaluation population" headline over-reports, so the
    headline excludes them and they are disclosed in their own sentence.
    Reason codes stay verbatim throughout — renaming breaks grep.
    """
    counts = (
        frame.group_by("reason").len().sort("len", descending=True).to_dicts()
    )
    baseline_only = frame.filter(
        pl.col("reason") == REASON_BASELINE_UNAVAILABLE
    ).height
    removed = frame.height - baseline_only
    return {
        "rows": frame.height,
        "candidates": candidate_count,
        "removedFromEvaluation": removed,
        "removedPct": removed / max(candidate_count, 1) * 100,
        "baselineUnavailable": baseline_only,
        "reasons": [{"reason": c["reason"], "count": c["len"]} for c in counts],
    }


def exclusion_headline(breakdown: dict) -> list[str]:
    lines = [
        f"{breakdown['removedFromEvaluation']:,} of "
        f"{breakdown['candidates']:,} candidates "
        f"({breakdown['removedPct']:.1f}%) are not in the evaluation population."
    ]
    if breakdown["baselineUnavailable"]:
        lines.append(
            f"{breakdown['baselineUnavailable']:,} further candidate(s) were "
            "projected but lack a baseline, so they are graded in the "
            "model-only population."
        )
    return lines


def exclusions(
    connect, run_id: str, *, reason: str | None = None, examples: int = 12
) -> tuple[str, bool]:
    run = load(connect, run_id)
    frame = art.read_dataset(Path(run["artifact_path"]), art.EXCLUSIONS)
    lines = report.status_band(run)

    if frame.height == 0:
        lines.append(
            f"No exclusions. All {run['candidate_count']:,} candidates were "
            "evaluated."
        )
        return "\n".join(lines), run["status"] == "completed"

    breakdown = exclusion_breakdown(frame, run["candidate_count"])
    lines += exclusion_headline(breakdown)
    lines.append("")
    lines.append(report.table(
        ["reason", "count"],
        [[c["reason"] + (" ⚠" if c["reason"] == "harness_error" else ""),
          f"{c['count']:,}"] for c in breakdown["reasons"]],
    ))
    lines.append("")
    lines.append(
        "Exclusions apply identically to the model and both baselines."
    )

    if reason:
        subset = frame.filter(pl.col("reason") == reason).head(examples)
        lines.append("")
        lines.append(f"examples — {reason} (showing {subset.height} of "
                     f"{frame.filter(pl.col('reason') == reason).height})")
        lines.append(report.table(
            ["game", "player", "stat", "stage", "detail"],
            [[r["game_id"][:8], (r["player_id"] or "—")[:8], r["stat_type"] or "—",
              r["stage"], r["detail"] or "—"] for r in subset.to_dicts()],
        ))
    return "\n".join(lines), run["status"] == "completed"


def exclusions_data(
    connect, run_id: str, *, reason: str | None = None, examples: int = 12
) -> tuple[dict, bool]:
    run = load(connect, run_id)
    frame = art.read_dataset(Path(run["artifact_path"]), art.EXCLUSIONS)
    payload = {
        "runId": run["id"],
        "status": run["status"],
        **exclusion_breakdown(frame, run["candidate_count"]),
    }
    if reason:
        matching = frame.filter(pl.col("reason") == reason)
        payload["examplesReason"] = reason
        payload["examplesTotal"] = matching.height
        payload["examples"] = matching.head(examples).to_dicts()
    return payload, run["status"] == "completed"


# --- thresholds ------------------------------------------------------------------


def _threshold_rows(row: dict, at: float | None) -> list[dict]:
    """P(X >= t) rows from stored parameters. Shared by text and JSON."""
    distribution = _rehydrate(row)
    stat = spec(row["stat_type"])
    wanted = [at] if at is not None else list(stat.thresholds)
    return [
        {
            "threshold": t,
            "probAtLeast": distribution.prob_at_least(t),
            "inGrid": t in stat.thresholds,
        }
        for t in wanted
    ]


def thresholds(
    connect, run_id: str, prediction_id: str, *, at: float | None = None
) -> tuple[str, bool]:
    """Evaluate any threshold from stored parameters — no engine, no corpus.

    This is the PRD criterion made operable: adding a threshold for an existing
    stat type must not require the model to be rerun.
    """
    run = load(connect, run_id)
    row = _prediction_row(run, run_id, prediction_id)
    rows = _threshold_rows(row, at)

    lines = [
        f"{row['player_id']} · {row['stat_type']} · {row['season']} "
        f"wk{row['week']:02d} · {row['distribution_kind']}",
        "evaluated from stored parameters; no engine code ran and no corpus read "
        "occurred.",
        "",
        report.table(
            ["threshold", "P(X >= t)", "in grid-v1"],
            [[f"{r['threshold']:.1f}", f"{r['probAtLeast']:.6f}",
              "yes" if r["inGrid"] else "no"] for r in rows],
        ),
    ]
    return "\n".join(lines), run["status"] == "completed"


def thresholds_data(
    connect, run_id: str, prediction_id: str, *, at: float | None = None
) -> tuple[dict, bool]:
    run = load(connect, run_id)
    row = _prediction_row(run, run_id, prediction_id)
    payload = {
        "runId": run["id"],
        "status": run["status"],
        "predictionId": row["prediction_id"],
        "playerId": row["player_id"],
        "statType": row["stat_type"],
        "season": row["season"],
        "week": row["week"],
        "distributionKind": row["distribution_kind"],
        "thresholds": _threshold_rows(row, at),
    }
    return payload, run["status"] == "completed"
