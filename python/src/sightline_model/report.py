"""Text rendering for the inspection commands.

Rendering only. Every number displayed was computed by the harness and stored;
nothing here recomputes a metric, because a viewer that computes its own
figures eventually disagrees with the thing it is meant to verify — and the
viewer always looks more convincing, since it is the one with the chart.

Two presentation rules are load-bearing rather than cosmetic:

* **A metric that was not computed renders as ``— (not computed)``.** A zero
  would be read as a measurement.
* **Any bound the command applies is disclosed with the total.** Silent
  truncation reads as complete coverage, which is the same failure as a
  silently narrowed population.
"""

from __future__ import annotations

from typing import Sequence

NOT_COMPUTED = "— (not computed)"
NOT_RECORDED = "— (not recorded)"


def table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    """Fixed-width, header always printed — including when there are no rows."""
    cells = [[str(c) for c in row] for row in rows]
    widths = [
        max(len(headers[i]), *(len(r[i]) for r in cells)) if cells else len(headers[i])
        for i in range(len(headers))
    ]
    out = ["  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)).rstrip()]
    out.append("  ".join("-" * w for w in widths))
    for row in cells:
        out.append("  ".join(c.ljust(widths[i]) for i, c in enumerate(row)).rstrip())
    return "\n".join(out)


def number(value, places: int = 2) -> str:
    if value is None:
        return NOT_COMPUTED
    return f"{value:,.{places}f}"


def status_band(run: dict) -> list[str]:
    """A full-width band above every aggregate when a run is not a result."""
    status = run["status"]
    if status == "completed":
        return []
    detail = run.get("error_message") or "no further detail recorded"
    return [
        "",
        f"!! {status.upper()} RUN — {detail}.",
        "!! The figures below cover only the completed portion and are NOT a",
        "!! backtest result. Do not compare them with a completed run.",
        "",
    ]


def manifest_block(run: dict) -> str:
    code = run["code_version"] or NOT_RECORDED
    if run["code_dirty"]:
        code += " (dirty)"
    seasons = (
        str(run["season_from"]) if run["season_from"] == run["season_to"]
        else f"{run['season_from']}-{run['season_to']}"
    )
    pairs = [
        ("run id", run["id"]),
        ("status", run["status"]),
        ("seasons", seasons),
        ("stat types", ", ".join(run["stat_types"])),
        ("window", run["evaluation_window"]),
        ("model version", run["model_version"]),
        ("code version", code),
        ("seed", f"{run['seed']} (rng draws {run['rng_draws']})"),
        ("cutoff policy", run["cutoff_policy"]),
        ("threshold policy", run["threshold_policy_version"]),
        ("grading target", run["grading_target"]),
        ("corpus digest", run["corpus_digest"]),
        ("engine config", run["engine_config_digest"]),
        ("predictions digest", run["predictions_digest"] or NOT_RECORDED),
        ("aggregate digest", run["aggregate_digest"] or NOT_RECORDED),
        ("calibration digest", run["calibration_digest"] or NOT_RECORDED),
        ("started", run["started_at"]),
        ("finished", run["finished_at"] or NOT_RECORDED),
        ("artefacts", run["artifact_path"]),
    ]
    width = max(len(k) for k, _ in pairs)
    return "\n".join(f"{k.ljust(width)}  {v}" for k, v in pairs)


def population_block(run: dict) -> str:
    return table(
        ["candidates", "projected", "unprojectable", "excluded", "comparison",
         "threshold obs"],
        [[
            f"{run['candidate_count']:,}",
            f"{run['projected_count']:,}",
            f"{run['unprojectable_count']:,}",
            f"{run['excluded_count']:,}",
            f"{run['comparison_count']:,}",
            f"{run['threshold_obs_count']:,}",
        ]],
    )


_SERIES = (("model", "model"), ("season-avg", "seasonAverage"),
           ("trailing-5", "trailingFive"))


def metrics_table(block: dict, label: str) -> str:
    """One breakout table. Best value per row marked with a leading dot."""
    comparison = block.get("comparison", {})
    rows: list[list[str]] = []
    for metric in ("mae", "rmse"):
        values = [comparison.get(key, {}).get(metric) for _, key in _SERIES]
        present = [v for v in values if v is not None]
        best = min(present) if present else None
        cells = [metric.upper()]
        for value in values:
            if value is None:
                cells.append(NOT_COMPUTED)
            else:
                marker = "· " if best is not None and value == best else ""
                cells.append(f"{marker}{value:,.2f}")
        n = comparison.get("model", {}).get("n")
        cells.append(f"{n:,}" if n is not None else NOT_COMPUTED)
        rows.append(cells)

    model_only = block.get("modelOnly", {}).get("model", {})
    if model_only:
        rows.append([
            "MAE (model-only)", f"{model_only['mae']:,.2f}", "—", "—",
            f"{model_only['n']:,}",
        ])
    return f"{label}\n" + table(
        ["metric", "model", "season-avg", "trailing-5", "n"], rows
    )


def thresholds_block(aggregates: dict) -> str:
    block = aggregates.get("overall", {}).get("thresholds")
    if not block:
        return f"thresholds: {NOT_COMPUTED}"
    return (
        f"Brier {block['brier']:.4f} · log loss {block['logLoss']:.4f} · "
        f"{block['observations']:,} threshold observations from "
        f"{block['projections']:,} projections.\n"
        "Threshold events drawn from one distribution are correlated; treat the "
        "projection count,\nnot the observation count, as the effective sample."
    )


ERA_NOTE = (
    "⚠ REANALYSIS — pre-2021 weather describes what the weather actually was, not\n"
    "  what was forecast before kickoff. Stronger performance in that era is\n"
    "  expected and is not evidence of model skill. Never read the total without\n"
    "  this split."
)


def calibration_table(bins: Sequence[dict]) -> str:
    rows = [
        [
            f"{b['bin_low']:.1f}-{b['bin_high']:.1f}",
            f"{float(b['predicted_mean']):.3f}",
            f"{float(b['observed_rate']):.3f}",
            f"{b['threshold_observations']:,}"
            + (" SPARSE" if b["below_floor"] else ""),
            f"{b['projection_count']:,}",
        ]
        for b in bins
    ]
    return table(
        ["bin", "predicted", "observed", "obs (n)", "projections"], rows
    )


def calibration_summary(bins: Sequence[dict], floor: int) -> str:
    """Where the model is over- or under-confident, and on what sample.

    Bins below the reporting floor are named but never used to support the
    claim — a summary sentence resting on eleven observations is a lie with a
    decimal point.
    """
    usable = [b for b in bins if not b["below_floor"]]
    if not usable:
        return (
            f"All bins are below the reporting floor of {floor:,} threshold "
            "observations.\nThis run cannot support a calibration claim."
        )
    worst = max(
        usable,
        key=lambda b: abs(float(b["predicted_mean"]) - float(b["observed_rate"])),
    )
    gap = float(worst["predicted_mean"]) - float(worst["observed_rate"])
    direction = "over-confident" if gap > 0 else "under-confident"
    excluded = len(bins) - len(usable)
    note = (
        f" {excluded} bin(s) below the floor were excluded from this summary."
        if excluded else ""
    )
    return (
        f"Model is most {direction} in bin "
        f"{worst['bin_low']:.1f}-{worst['bin_high']:.1f}: predicted "
        f"{float(worst['predicted_mean']):.3f}, observed "
        f"{float(worst['observed_rate']):.3f} on "
        f"{worst['threshold_observations']:,} observations from "
        f"{worst['projection_count']:,} projections.{note}"
    )


def sample_disclosure(shown: int, total: int, *, filtered: int) -> str:
    """State the bound, the filtered total, and the run total. Always."""
    return (
        f"showing {shown:,} of {filtered:,} matching ({total:,} in this run). "
        "Filters apply to all of them; the limit is only what is rendered."
    )
