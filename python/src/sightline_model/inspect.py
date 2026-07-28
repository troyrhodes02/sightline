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
from .constants import REPORTING_FLOOR
from .distributions import NegativeBinomial, ZeroInflatedLogNormal
from .stat_types import spec

COHORTS = (
    "sparse", "low_confidence", "returning", "role_change", "impossible_output",
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
    return "\n".join(lines), run["status"] == "completed"


# --- calibration --------------------------------------------------------------


def calibration(
    connect, run_id: str, *, stat: str | None = None, era: str | None = None
) -> tuple[str, bool]:
    run = load(connect, run_id)
    bins = [
        b for b in persist.load_calibration_bins(connect, run_id)
        if b["stat_type"] == stat and b["era"] == era and b["season"] is None
    ]
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


# --- predictions ---------------------------------------------------------------


def predictions(
    connect, run_id: str, *, cohort: str | None = None, player: str | None = None,
    sort: str = "err", limit: int = 50,
) -> tuple[str, bool]:
    run = load(connect, run_id)
    frame = _predictions(run)
    total = frame.height
    lines = report.status_band(run)

    if total == 0:
        lines.append("No predictions were produced. There is nothing to inspect.")
        return "\n".join(lines), run["status"] == "completed"

    if cohort:
        frame = frame.filter(pl.col("cohorts").str.contains(cohort))
    if player:
        frame = frame.filter(pl.col("player_id").str.contains(player))

    filtered = frame.height
    if filtered == 0:
        lines.append(
            f"No predictions match. {total:,} in this run. "
            "Clear the filters to see them."
        )
        return "\n".join(lines), run["status"] == "completed"

    sort_column = {"err": "abs_error", "proj": "projected_value",
                   "wk": "week", "n": "n_eff"}.get(sort, "abs_error")
    frame = frame.sort(sort_column, descending=True).head(limit)

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


# --- explain -------------------------------------------------------------------


def _rehydrate(row: dict):
    params = json.loads(row["params"])
    if row["distribution_kind"] == ZeroInflatedLogNormal.kind:
        return ZeroInflatedLogNormal(**params)
    pmf = json.loads(row["pmf"]) if row["pmf"] else []
    return NegativeBinomial(**params, cap=max(len(pmf) - 1, 1))


def explain(connect, run_id: str, prediction_id: str) -> tuple[str, bool]:
    run = load(connect, run_id)
    frame = _predictions(run).filter(pl.col("prediction_id") == prediction_id)
    if frame.height == 0:
        raise RunNotFound(f"no prediction {prediction_id!r} in run {run_id}")
    row = frame.to_dicts()[0]
    distribution = _rehydrate(row)
    stat = spec(row["stat_type"])

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
        f"≥{t:>6.1f} {distribution.prob_at_least(t):.3f}" for t in stat.thresholds
    ))

    lines.append("")
    lines.append("TEMPORAL")
    lines.append(f"  kickoff             {row['kickoff_at']}")
    lines.append(f"  information cutoff  {row['information_cutoff']}")
    lines.append(f"  computed at         {row['computed_at']}")
    if row["information_cutoff"] >= row["kickoff_at"]:
        lines.append("  !! CUTOFF AT OR AFTER KICKOFF — this projection could see "
                     "the game it predicts.")

    lines.append("")
    lines.append("DRIVERS")
    for driver in json.loads(row["drivers"]):
        lines.append(f"  · {driver}")

    lines.append("")
    lines.append("ELIGIBLE SOURCE RECORDS (live diagnostic read at the stored cutoff)")
    sources = diagnostics.eligible_sources(
        connect, player_id=row["player_id"], game_id=row["game_id"],
        cutoff=row["information_cutoff"],
    )
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
    excluded = diagnostics.excluded_by_cutoff(
        connect, player_id=row["player_id"], game_id=row["game_id"],
        cutoff=row["information_cutoff"],
    )
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


# --- exclusions ----------------------------------------------------------------


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

    counts = (
        frame.group_by("reason").len().sort("len", descending=True).to_dicts()
    )
    lines.append(
        f"{frame.height:,} of {run['candidate_count']:,} candidates "
        f"({frame.height / max(run['candidate_count'], 1) * 100:.1f}%) are not in "
        "the evaluation population."
    )
    lines.append("")
    lines.append(report.table(
        ["reason", "count"],
        [[c["reason"] + (" ⚠" if c["reason"] == "harness_error" else ""),
          f"{c['len']:,}"] for c in counts],
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


# --- thresholds ------------------------------------------------------------------


def thresholds(
    connect, run_id: str, prediction_id: str, *, at: float | None = None
) -> tuple[str, bool]:
    """Evaluate any threshold from stored parameters — no engine, no corpus.

    This is the PRD criterion made operable: adding a threshold for an existing
    stat type must not require the model to be rerun.
    """
    run = load(connect, run_id)
    frame = _predictions(run).filter(pl.col("prediction_id") == prediction_id)
    if frame.height == 0:
        raise RunNotFound(f"no prediction {prediction_id!r} in run {run_id}")
    row = frame.to_dicts()[0]
    distribution = _rehydrate(row)
    stat = spec(row["stat_type"])
    wanted = [at] if at is not None else list(stat.thresholds)

    lines = [
        f"{row['player_id']} · {row['stat_type']} · {row['season']} "
        f"wk{row['week']:02d} · {row['distribution_kind']}",
        "evaluated from stored parameters; no engine code ran and no corpus read "
        "occurred.",
        "",
        report.table(
            ["threshold", "P(X >= t)", "in grid-v1"],
            [[f"{t:.1f}", f"{distribution.prob_at_least(t):.6f}",
              "yes" if t in stat.thresholds else "no"] for t in wanted],
        ),
    ]
    return "\n".join(lines), run["status"] == "completed"
