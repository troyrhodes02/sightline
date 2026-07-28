"""``sightline-backtest verify`` — the command that makes the claims checkable.

Every other command in this package renders what a run stored. This one
recomputes from the raw artefacts and asserts the stored summary agrees, then
asserts the properties a run must have to be worth reading at all.

It is written to fail. A leaking backtest reports *better* numbers, not worse
ones, so a verifier that mostly confirms things would be worse than useless —
it would launder the one failure nobody would otherwise question.

One distinction it is careful about: a repeat run over a **changed corpus** is
a different experiment, not a reproducibility failure. Reporting them the same
way would train the operator to ignore the real one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import polars as pl

from . import artifacts as art
from . import persist
from .digests import digest_mapping, digest_rows
from .harness import RunTotals
from .metrics import summarise


@dataclass
class Findings:
    failures: list[str] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)
    checks: list[str] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append(name)
        if not ok:
            self.failures.append(f"{name}: {detail}" if detail else name)

    def notice(self, message: str) -> None:
        self.notices.append(message)

    @property
    def passed(self) -> bool:
        return not self.failures


def verify_run(
    connect, run_id: str, *, against: str | None = None, strict: bool = False
) -> Findings:
    findings = Findings()
    run = persist.load_run(connect, run_id)
    if run is None:
        findings.check("run exists", False, f"no run with id {run_id!r}")
        return findings

    root = Path(run["artifact_path"])
    predictions = art.read_dataset(root, art.PREDICTIONS)
    thresholds = art.read_dataset(root, art.THRESHOLDS)
    exclusions = art.read_dataset(root, art.EXCLUSIONS)

    _check_completion(findings, run, root)
    _check_temporal(findings, predictions)
    _check_distributions(findings, predictions)
    _check_population(findings, run, predictions, thresholds, exclusions)
    _check_recomputation(findings, connect, run, predictions, thresholds, exclusions)
    if against:
        _check_reproducibility(findings, connect, run, against)
    if strict:
        _check_attribution(findings, run)
    return findings


def _check_completion(findings: Findings, run: dict, root: Path) -> None:
    marker = art.is_complete(root)
    completed = run["status"] == "completed"
    # A crash between the marker and the row update is exactly the state that
    # gets presented as a finished backtest six weeks later.
    findings.check(
        "marker and status agree",
        marker == completed,
        f"_COMPLETE={marker} but status={run['status']}",
    )
    findings.check(
        "rng draws are zero",
        run["rng_draws"] == 0,
        f"the engine recorded {run['rng_draws']} draws; it is meant to be "
        "closed-form, so determinism would no longer be a property of the "
        "computation",
    )
    if completed:
        for column in ("predictions_digest", "aggregate_digest", "calibration_digest"):
            findings.check(f"{column} present", bool(run[column]))


def _check_temporal(findings: Findings, predictions: pl.DataFrame) -> None:
    if predictions.height == 0:
        return
    late = predictions.filter(
        pl.col("information_cutoff") >= pl.col("kickoff_at")
    )
    findings.check(
        "no cutoff at or after its own kickoff",
        late.height == 0,
        f"{late.height} prediction(s) could see the game they predict; every "
        "aggregate containing them is invalid",
    )


def _check_distributions(findings: Findings, predictions: pl.DataFrame) -> None:
    if predictions.height == 0:
        return
    impossible = predictions.filter(pl.col("mass_below_zero") > 0)
    findings.check(
        "no mass below zero",
        impossible.height == 0,
        f"{impossible.height} prediction(s) place probability below zero, so "
        "the distribution family is wrong for the stat",
    )
    if "actual_percentile" in predictions.columns:
        out_of_range = predictions.filter(
            (pl.col("actual_percentile") < 0) | (pl.col("actual_percentile") > 1)
        )
        findings.check("percentiles within [0,1]", out_of_range.height == 0)


def _check_population(
    findings: Findings, run: dict, predictions: pl.DataFrame,
    thresholds: pl.DataFrame, exclusions: pl.DataFrame,
) -> None:
    findings.check(
        "population reconciles",
        run["projected_count"] + run["unprojectable_count"] + run["excluded_count"]
        == run["candidate_count"],
        f"{run['projected_count']} + {run['unprojectable_count']} + "
        f"{run['excluded_count']} != {run['candidate_count']}",
    )
    findings.check(
        "predictions match the projected count",
        predictions.height == run["projected_count"],
        f"{predictions.height} rows vs {run['projected_count']} recorded",
    )
    findings.check(
        "threshold observations match the artefacts",
        thresholds.height == run["threshold_obs_count"],
        f"{thresholds.height} rows vs {run['threshold_obs_count']} recorded",
    )
    if predictions.height == 0:
        return

    comparison = predictions.filter(pl.col("in_comparison_population"))
    for column in ("baseline_season_avg", "baseline_trailing5"):
        missing = comparison.filter(pl.col(column).is_null())
        findings.check(
            f"comparison population has {column}",
            missing.height == 0,
            f"{missing.height} comparison row(s) lack {column}, so the model "
            "and that baseline were scored over different populations",
        )
    findings.check(
        "comparison count matches the artefacts",
        comparison.height == run["comparison_count"],
        f"{comparison.height} rows vs {run['comparison_count']} recorded",
    )
    del exclusions  # counted via the run row; retained for future checks


def _check_recomputation(
    findings: Findings, connect, run: dict, predictions: pl.DataFrame,
    thresholds: pl.DataFrame, exclusions: pl.DataFrame,
) -> None:
    """Recompute from raw rows and require the stored summary to agree."""
    if run["status"] != "completed":
        return
    totals = RunTotals(
        candidates=run["candidate_count"],
        projected=run["projected_count"],
        unprojectable=run["unprojectable_count"],
        excluded=run["excluded_count"],
        comparison=run["comparison_count"],
        threshold_observations=run["threshold_obs_count"],
    )
    summary = summarise(predictions, thresholds, totals, exclusions)

    # The primary artefact is covered by recomputing its digest FROM DISK.
    # The run-time digest was taken over the in-memory buffer; without this,
    # a Parquet write fault — or a post-hoc edit to any column the aggregates
    # do not read — would pass every other check.
    findings.check(
        "predictions on disk match the stored digest",
        digest_rows(
            predictions.to_dicts(),
            sort_keys=["game_id", "player_id", "stat_type"],
        ) == run["predictions_digest"],
        "the predictions dataset on disk is not the one the digest was taken "
        "over — a write fault or a post-hoc edit",
    )

    # Two distinct checks, and both are needed. The first catches the stored
    # aggregates being edited after the fact — the digest column would still
    # match a recomputation from raw rows, because the digest was taken before
    # the edit. The second catches the summary and the raw rows disagreeing.
    findings.check(
        "stored aggregates match their own digest",
        digest_mapping(run["aggregates"]) == run["aggregate_digest"],
        "the aggregates blob has been modified since the digest was taken",
    )
    findings.check(
        "stored aggregates match a recomputation",
        summary.aggregate_digest == run["aggregate_digest"],
        "the stored summary and the raw rows disagree",
    )
    findings.check(
        "stored calibration bins match a recomputation",
        summary.calibration_digest == run["calibration_digest"],
        "the stored bins and the raw rows disagree",
    )

    stored_bins = persist.load_calibration_bins(connect, run["id"])
    findings.check(
        "calibration bin count matches",
        len(stored_bins) == len(summary.bins),
        f"{len(stored_bins)} stored vs {len(summary.bins)} recomputed",
    )
    for row in stored_bins:
        if row["projection_count"] > row["threshold_observations"]:
            findings.check("bin sample sizes ordered", False, str(row))
            break
    else:
        findings.check("bin sample sizes ordered", True)


def _check_reproducibility(
    findings: Findings, connect, run: dict, against: str
) -> None:
    other = persist.load_run(connect, against)
    if other is None:
        findings.check("comparison run exists", False, f"no run {against!r}")
        return

    # "Same experiment" is the full input set, not just the corpus and engine
    # digests: two runs over the same corpus with different seasons, stat
    # types, season types, window, or a --limit-games truncation share both
    # digests and would otherwise be reported as three reproducibility
    # FAILURES — the operator-desensitising outcome this module exists to
    # prevent. Scope lives on the run row; limit_games lives only in the
    # manifest, so compare that too when both manifests are readable.
    scope_columns = (
        "season_from", "season_to", "stat_types", "season_types",
        "evaluation_window",
    )
    same_inputs = (
        run["corpus_digest"] == other["corpus_digest"]
        and run["engine_config_digest"] == other["engine_config_digest"]
        and all(run[c] == other[c] for c in scope_columns)
        and _manifest_config(run) == _manifest_config(other)
    )
    if not same_inputs:
        # Not a failure. A different corpus, engine config, or run scope is a
        # DIFFERENT EXPERIMENT, and reporting it as a reproducibility failure
        # would train the operator to ignore the real one.
        findings.notice(
            f"different experiment: run {against[:8]} was computed over a "
            "different corpus state, engine configuration, or run scope, so "
            "its digests are not expected to match."
        )
        return

    for column in ("predictions_digest", "aggregate_digest", "calibration_digest"):
        findings.check(
            f"{column} reproduces",
            run[column] == other[column],
            f"{run[column]} != {other[column]}",
        )


def _manifest_config(run: dict) -> dict | None:
    """The run's config block from its manifest, or ``None`` if unreadable.

    ``None == None`` deliberately compares equal: two runs whose manifests are
    both missing fall back to the row-level scope comparison rather than being
    unconditionally declared different experiments.
    """
    try:
        return art.read_manifest(Path(run["artifact_path"])).get("config")
    except (OSError, ValueError):
        return None


def _check_attribution(findings: Findings, run: dict) -> None:
    """--strict: a run nobody can attribute to a commit is not evidence."""
    findings.check(
        "code version recorded",
        run["code_version"] not in (None, "", "unknown"),
        "code_version is unknown; the run cannot be tied to an implementation",
    )
    findings.check(
        "working tree was clean",
        not run["code_dirty"],
        "the run was produced from uncommitted code and is not reproducible",
    )


def render(findings: Findings, run_id: str) -> str:
    lines = [f"verify {run_id}", ""]
    for check in findings.checks:
        failed = any(f.startswith(check) for f in findings.failures)
        lines.append(f"  {'FAIL' if failed else 'ok  '}  {check}")
    if findings.notices:
        lines.append("")
        for notice in findings.notices:
            lines.append(f"  note  {notice}")
    lines.append("")
    if findings.passed:
        lines.append(f"{len(findings.checks)} checks passed.")
    else:
        lines.append(f"{len(findings.failures)} of {len(findings.checks)} checks FAILED:")
        for failure in findings.failures:
            lines.append(f"  · {failure}")
    return "\n".join(lines)
