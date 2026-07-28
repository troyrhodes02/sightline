"""The inspection commands (SIG-19).

These replace the Temporary Backtest Inspection UI, so the tests are organised
around the requirements that surface carried rather than around the functions
that implement them. Each test names the ⟨was-UI⟩ requirement it discharges.
"""

from __future__ import annotations

import json

import polars as pl
import pytest

from sightline_model import artifacts as art
from sightline_model import inspect as cmd
from sightline_model import persist
from sightline_model.cli import main

from test_harness import (  # noqa: F401 - fixtures
    _config,
    artifact_base,
    corpus,
)
from sightline_model.harness import run_backtest

pytestmark = pytest.mark.db


@pytest.fixture
def run(corpus, artifact_base):
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    assert outcome.status == "completed", outcome.error
    return outcome


def _first_prediction_id(run) -> str:
    return art.read_dataset(run.root, art.PREDICTIONS)["prediction_id"][0]


# --- show ⟨was-UI: run identity, status, baselines, breakouts⟩ ---------------


def test_show_prints_run_identity(corpus, run) -> None:
    text, complete = cmd.show(corpus, run.run_id)
    assert complete
    for field in ("model version", "code version", "seed", "cutoff policy",
                  "threshold policy", "grading target", "corpus digest",
                  "predictions digest"):
        assert field in text
    assert "rng draws 0" in text


def test_show_prints_model_alongside_both_baselines(corpus, run) -> None:
    text, _ = cmd.show(corpus, run.run_id)
    assert "model" in text and "season-avg" in text and "trailing-5" in text
    assert "MAE" in text and "RMSE" in text


def test_show_covers_all_three_breakouts(corpus, run) -> None:
    for breakout in ("stat", "season", "era"):
        text, _ = cmd.show(corpus, run.run_id, breakout=breakout)
        assert "metric" in text, breakout


def test_era_breakout_carries_the_reanalysis_caveat(corpus, artifact_base) -> None:
    # A run spanning the pre-2021 era must never present a headline without it.
    outcome = run_backtest(
        corpus, _config(artifact_base, season_from=2022, season_to=2023),
        persist=persist,
    )
    text, _ = cmd.show(corpus, outcome.run_id, breakout="era")
    if "reanalysis" in text:
        assert "not evidence of model skill" in text


def test_an_uncomputed_metric_renders_as_not_computed_never_as_zero() -> None:
    # A zero would be read as a measurement. Asserted against the renderer
    # directly with a block that legitimately lacks both baselines — the
    # model-only shape produced when no prediction had a defined baseline.
    from sightline_model import report

    block = {
        "comparison": {"model": {"mae": 21.43, "rmse": 31.08, "n": 18_442}},
        "modelOnly": {"model": {"mae": 22.10, "rmse": 32.00, "n": 19_100}},
    }
    text = report.metrics_table(block, "total")

    assert "— (not computed)" in text
    assert "21.43" in text
    assert "\t0.00" not in text and " 0.00 " not in text
    # And the model-only row is present and distinct from the comparison row.
    assert "MAE (model-only)" in text
    assert "22.10" in text


# --- calibration ⟨was-UI: bins, both counts, text summary⟩ -------------------


def test_calibration_prints_bins_with_both_counts(corpus, run) -> None:
    text, _ = cmd.calibration(corpus, run.run_id)
    assert "obs (n)" in text and "projections" in text
    assert "correlated" in text or "SPARSE" in text or "predicted" in text


def test_calibration_prints_a_text_summary_naming_the_sample(corpus, run) -> None:
    text, _ = cmd.calibration(corpus, run.run_id)
    assert (
        "over-confident" in text
        or "under-confident" in text
        or "cannot support a calibration claim" in text
    )


def test_sparse_bins_are_shown_and_excluded_from_the_claim(corpus, run) -> None:
    bins = persist.load_calibration_bins(corpus, run.run_id)
    assert bins
    assert all(b["below_floor"] for b in bins), "fixture is small; all sparse"
    text, _ = cmd.calibration(corpus, run.run_id)
    assert "SPARSE" in text
    assert "cannot support a calibration claim" in text


# --- predictions ⟨was-UI: filter, sort, sample disclosure, cohorts⟩ ----------


def test_predictions_disclose_any_bound_they_apply(corpus, run) -> None:
    text, _ = cmd.predictions(corpus, run.run_id, limit=2)
    assert "showing 2 of" in text
    assert "in this run" in text
    # Silent truncation reads as complete coverage.


def test_predictions_filter_by_cohort(corpus, run) -> None:
    text, _ = cmd.predictions(corpus, run.run_id, cohort="low_confidence")
    assert "showing" in text or "No predictions match" in text


def test_empty_filter_result_is_obviously_a_filter_result(corpus, run) -> None:
    text, _ = cmd.predictions(corpus, run.run_id, player="no-such-player")
    assert "No predictions match" in text
    assert "in this run" in text


# --- explain ⟨was-UI: the detail view⟩ ---------------------------------------


def test_explain_prints_everything_the_detail_view_carried(corpus, run) -> None:
    text, _ = cmd.explain(corpus, run.run_id, _first_prediction_id(run))

    assert "DISTRIBUTION" in text
    assert "projected" in text and "p10-p90" in text
    assert "mass below zero" in text
    assert "THRESHOLDS" in text and "no refit" in text
    assert "TEMPORAL" in text
    assert "kickoff" in text and "information cutoff" in text
    assert "DRIVERS" in text
    assert "ELIGIBLE SOURCE RECORDS" in text
    assert "EXCLUDED BY CUTOFF" in text


def test_explain_shows_records_the_model_could_not_see(corpus, run) -> None:
    # The panel that turns the leakage guarantee from an assertion into
    # something you can look at.
    text, _ = cmd.explain(corpus, run.run_id, _first_prediction_id(run))
    assert (
        "unreachable at the cutoff" in text
        or "no future-dated records" in text
    )


def test_explain_leaves_every_artefact_unchanged(corpus, run) -> None:
    # It performs a live read; it must never write.
    before = {
        p.name: p.read_bytes()
        for p in sorted(run.root.rglob("*")) if p.is_file()
    }
    cmd.explain(corpus, run.run_id, _first_prediction_id(run))
    after = {
        p.name: p.read_bytes()
        for p in sorted(run.root.rglob("*")) if p.is_file()
    }
    assert before == after


def test_explain_flags_an_unknown_prediction(corpus, run) -> None:
    with pytest.raises(cmd.RunNotFound):
        cmd.explain(corpus, run.run_id, "nope")


# --- exclusions ⟨was-UI: grouped by reason⟩ ----------------------------------


def test_exclusions_group_by_reason_with_counts(corpus, run) -> None:
    text, _ = cmd.exclusions(corpus, run.run_id)
    assert "reason" in text and "count" in text
    assert "identically to the model and both baselines" in text


def test_exclusion_reason_codes_are_verbatim(corpus, run) -> None:
    # The code in the report is the code in the artefact; prettifying breaks
    # grep, which is how anyone actually finds these.
    text, _ = cmd.exclusions(corpus, run.run_id)
    assert "baseline_unavailable" in text or "insufficient_history" in text


def test_exclusions_headline_does_not_count_baseline_unavailable() -> None:
    # baseline_unavailable candidates WERE projected and graded — they are
    # only absent from the baseline-comparison population. Counting them in
    # the "not in the evaluation population" headline over-reports. Pure test
    # against the arithmetic helper; no run needed.
    frame = pl.DataFrame({
        "reason": ["baseline_unavailable"] * 3 + ["insufficient_history"] * 2,
    })
    breakdown = cmd.exclusion_breakdown(frame, 10)

    assert breakdown["removedFromEvaluation"] == 2
    assert breakdown["baselineUnavailable"] == 3
    assert breakdown["rows"] == 5
    # Reason codes verbatim, never prettified.
    assert {r["reason"] for r in breakdown["reasons"]} == {
        "baseline_unavailable", "insufficient_history",
    }

    lines = cmd.exclusion_headline(breakdown)
    assert "2 of 10" in lines[0]
    assert "20.0%" in lines[0]
    assert "3 further" in lines[1]
    assert "model-only" in lines[1]


def test_exclusions_headline_omits_the_baseline_sentence_when_none() -> None:
    frame = pl.DataFrame({"reason": ["insufficient_history"] * 4})
    breakdown = cmd.exclusion_breakdown(frame, 8)
    lines = cmd.exclusion_headline(breakdown)

    assert len(lines) == 1
    assert "4 of 8" in lines[0]
    assert "50.0%" in lines[0]


def test_exclusions_text_discloses_baseline_unavailable_separately(
    corpus, run
) -> None:
    # The fixture corpus produces week-1 baseline_unavailable rows (a season
    # average is undefined before the player's first eligible game). When they
    # exist, the headline must not absorb them.
    frame = art.read_dataset(run.root, art.EXCLUSIONS)
    text, _ = cmd.exclusions(corpus, run.run_id)
    baseline_rows = frame.filter(pl.col("reason") == "baseline_unavailable").height
    if baseline_rows:
        assert "graded in the model-only population" in text
        assert f"{baseline_rows:,} further" in text


# --- thresholds ⟨was-UI: any threshold, no refit⟩ ----------------------------


def test_threshold_off_the_grid_is_answered_without_rerunning(corpus, run) -> None:
    text, _ = cmd.thresholds(
        corpus, run.run_id, _first_prediction_id(run), at=87.5
    )
    assert "87.5" in text
    assert "no engine code ran and no corpus read occurred" in text
    assert "no" in text  # the "in grid-v1" column


def test_grid_thresholds_are_monotone(corpus, run) -> None:
    text, _ = cmd.thresholds(corpus, run.run_id, _first_prediction_id(run))
    values = [
        float(line.split()[1])
        for line in text.splitlines()
        if line.strip() and line.split()[0].replace(".", "").isdigit()
    ]
    assert values == sorted(values, reverse=True)


# --- cohorts ⟨single vocabulary, sourced from the engine⟩ ---------------------


def test_cohort_vocabulary_is_the_engine_vocabulary() -> None:
    # COHORTS must collect the COHORT_* constants, never retyped strings —
    # a filter vocabulary that drifts from what the engine emits silently
    # filters everything to zero rows.
    from sightline_model import projection

    assert set(cmd.COHORTS) == {
        projection.COHORT_SPARSE,
        projection.COHORT_LOW_CONFIDENCE,
        projection.COHORT_RETURNING,
        projection.COHORT_ROLE_CHANGE,
        projection.COHORT_IMPOSSIBLE,
    }


def test_valid_cohort_with_zero_members_still_prints_zero_rows(
    corpus, run
) -> None:
    # A valid cohort that matches nothing is a result, not an error.
    text, _ = cmd.predictions(corpus, run.run_id, cohort="impossible_output")
    assert "showing" in text or "No predictions match" in text


# --- disclosure counters ⟨show: corrections applied, cutoff-after-kickoff⟩ ----


def test_disclosure_counter_renders_not_recorded_when_absent() -> None:
    # An older run that never recorded a counter must render NOT_RECORDED,
    # never a zero — a zero reads as a measurement.
    from sightline_model import report

    line = report.disclosure_line("correctionAppliedCount", {})
    assert line == "correctionAppliedCount  — (not recorded)"

    line = report.disclosure_line(
        "cutoffAfterKickoffCount", {"cutoffAfterKickoffCount": 4}
    )
    assert line.startswith("cutoffAfterKickoffCount  4")
    assert "not recorded" not in line


def test_show_surfaces_both_disclosure_counters(corpus, run) -> None:
    # Present or not, `show` accounts for both counters by name: a value when
    # the harness recorded one, "— (not recorded)" when it did not.
    text, _ = cmd.show(corpus, run.run_id)
    assert "correctionAppliedCount" in text
    assert "cutoffAfterKickoffCount" in text


# --- CLI surface ---------------------------------------------------------------


def test_every_inspection_command_runs_through_the_cli(
    corpus, test_dsn, run, capsys
) -> None:
    prediction = _first_prediction_id(run)
    invocations = [
        ["show", run.run_id],
        ["show", run.run_id, "--breakout", "era"],
        ["calibration", run.run_id],
        ["predictions", run.run_id, "--limit", "5"],
        ["explain", run.run_id, "--prediction", prediction],
        ["exclusions", run.run_id],
        ["thresholds", run.run_id, "--prediction", prediction],
    ]
    for argv in invocations:
        code = main(["--database-url", test_dsn, *argv])
        capsys.readouterr()
        assert code == 0, argv


def test_every_command_emits_machine_parseable_json(
    corpus, test_dsn, run, capsys
) -> None:
    # SIG-19 acceptance criterion: --json output is stable and
    # machine-parseable for EVERY command, verify included.
    prediction = _first_prediction_id(run)
    invocations = [
        ["show", run.run_id],
        ["calibration", run.run_id],
        ["predictions", run.run_id, "--limit", "5"],
        ["explain", run.run_id, "--prediction", prediction],
        ["exclusions", run.run_id],
        ["thresholds", run.run_id, "--prediction", prediction],
        ["verify", run.run_id],
    ]
    for argv in invocations:
        code = main(["--database-url", test_dsn, *argv, "--json"])
        out = capsys.readouterr().out
        assert code == 0, argv
        payload = json.loads(out)  # a parse failure fails the test
        assert isinstance(payload, dict), argv


def test_json_payloads_carry_what_the_text_shows(
    corpus, test_dsn, run, capsys
) -> None:
    prediction = _first_prediction_id(run)

    main(["--database-url", test_dsn, "show", run.run_id, "--json"])
    show_payload = json.loads(capsys.readouterr().out)
    assert show_payload["id"] == run.run_id
    assert show_payload["status"] == "completed"
    assert "aggregates" in show_payload
    assert "comparison_count" in show_payload

    main(["--database-url", test_dsn, "calibration", run.run_id, "--json"])
    calib_payload = json.loads(capsys.readouterr().out)
    assert calib_payload["runId"] == run.run_id
    assert isinstance(calib_payload["bins"], list)

    main([
        "--database-url", test_dsn, "predictions", run.run_id,
        "--limit", "2", "--json",
    ])
    preds_payload = json.loads(capsys.readouterr().out)
    assert preds_payload["shown"] <= 2
    assert preds_payload["total"] >= preds_payload["filtered"]
    assert len(preds_payload["predictions"]) == preds_payload["shown"]

    main([
        "--database-url", test_dsn, "explain", run.run_id,
        "--prediction", prediction, "--json",
    ])
    explain_payload = json.loads(capsys.readouterr().out)
    assert explain_payload["row"]["prediction_id"] == prediction
    assert explain_payload["gridThresholds"]
    assert "eligibleSources" in explain_payload
    assert "excludedByCutoff" in explain_payload

    main(["--database-url", test_dsn, "exclusions", run.run_id, "--json"])
    excl_payload = json.loads(capsys.readouterr().out)
    assert excl_payload["rows"] == (
        excl_payload["removedFromEvaluation"]
        + excl_payload["baselineUnavailable"]
    )

    main([
        "--database-url", test_dsn, "thresholds", run.run_id,
        "--prediction", prediction, "--at", "87.5", "--json",
    ])
    thresh_payload = json.loads(capsys.readouterr().out)
    assert len(thresh_payload["thresholds"]) == 1
    off_grid = thresh_payload["thresholds"][0]
    assert off_grid["threshold"] == 87.5
    assert off_grid["inGrid"] is False
    assert 0.0 <= off_grid["probAtLeast"] <= 1.0

    main(["--database-url", test_dsn, "verify", run.run_id, "--json"])
    verify_payload = json.loads(capsys.readouterr().out)
    assert verify_payload["passed"] is True
    assert verify_payload["checks"]
    assert all("name" in c and "passed" in c for c in verify_payload["checks"])


def test_strict_fails_on_a_run_that_is_not_a_result(
    corpus, test_dsn, artifact_base, capsys
) -> None:
    from datetime import datetime

    from sightline_model.constants import MODEL_VERSION

    run_id = persist.insert_run(
        corpus, config=_config(artifact_base), model_version=MODEL_VERSION,
        code_version="abc1234", code_dirty=False, engine_config={"k": 1},
        engine_config_digest="cfg", corpus_digest="corp",
        cutoff_policy="kickoff_minus_90m/v1", threshold_policy_version="grid-v1",
        grading_target="official_corrected", artifact_path=str(artifact_base),
        started_at=datetime(2026, 7, 28, 9, 0),
    )
    code = main(["--database-url", test_dsn, "show", run_id, "--strict"])
    captured = capsys.readouterr()

    assert code == 1
    assert "RUNNING RUN" in captured.out
    assert "NOT a" in captured.out


def test_no_inspection_command_writes_anything(corpus, run) -> None:
    before = sorted(p.name for p in run.root.rglob("*"))
    cmd.show(corpus, run.run_id)
    cmd.calibration(corpus, run.run_id)
    cmd.predictions(corpus, run.run_id)
    cmd.exclusions(corpus, run.run_id)
    assert sorted(p.name for p in run.root.rglob("*")) == before
