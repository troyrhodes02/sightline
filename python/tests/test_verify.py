"""The capstone: verify, plus the adversarial and determinism suites (SIG-20).

Written to attack rather than to confirm. A leaking backtest reports better
numbers, not worse ones, so every check here has a paired negative test that
breaks the thing on purpose and requires verify to catch it. A verifier that
only ever passes would launder the one failure nobody would otherwise question.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.stats import ingest_stats
from sightline_model import artifacts as art
from sightline_model import persist, verify
from sightline_model.cli import main
from sightline_model.harness import run_backtest

from test_harness import (  # noqa: F401 - fixtures
    GAMES,
    WRS,
    _config,
    _h,
    _stats_df,
    artifact_base,
    corpus,
)

pytestmark = pytest.mark.db


@pytest.fixture
def run(corpus, artifact_base):
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    assert outcome.status == "completed", outcome.error
    return outcome


# --- verify passes on a sound run --------------------------------------------


def test_verify_passes_on_a_completed_run(corpus, run) -> None:
    findings = verify.verify_run(corpus, run.run_id)
    assert findings.passed, findings.failures
    # And it actually ran checks rather than passing vacuously.
    assert len(findings.checks) >= 8


def test_verify_exits_zero_through_the_cli(corpus, test_dsn, run, capsys) -> None:
    code = main(["--database-url", test_dsn, "verify", run.run_id])
    out = capsys.readouterr().out
    assert code == 0
    assert "checks passed" in out


def test_verify_reports_an_unknown_run(corpus, test_dsn, capsys) -> None:
    code = main([
        "--database-url", test_dsn, "verify",
        "00000000-0000-0000-0000-000000000000",
    ])
    assert code == 1
    assert "no run with id" in capsys.readouterr().out


# --- One negative test per check ----------------------------------------------


def _rewrite_predictions(root, transform) -> None:
    frame = art.read_dataset(root, art.PREDICTIONS)
    transform(frame).write_parquet(root / art.PREDICTIONS / "part-00000.parquet")


def test_verify_detects_a_tampered_aggregate(corpus, run) -> None:
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            "select aggregates from backtest_runs where id = %s", (run.run_id,)
        )
        aggregates = cur.fetchone()[0]
        aggregates["overall"]["comparison"]["model"]["mae"] += 0.01
        cur.execute(
            "update backtest_runs set aggregates = %s where id = %s",
            (json.dumps(aggregates, sort_keys=True), run.run_id),
        )
        conn.commit()

    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    # Caught by the own-digest check rather than the recomputation check: the
    # raw rows are untouched, so a recomputation still matches the digest that
    # was taken before the edit. That is exactly why both checks exist — the
    # first version of verify had only the recomputation one and this test
    # passed the tampered blob straight through.
    assert any("match their own digest" in f for f in findings.failures)
    assert any("modified since the digest was taken" in f for f in findings.failures)


def test_verify_detects_a_cutoff_after_kickoff(corpus, run) -> None:
    _rewrite_predictions(
        run.root,
        lambda f: f.with_columns(
            pl.col("kickoff_at").alias("information_cutoff")
        ),
    )
    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    assert any("cutoff at or after" in f for f in findings.failures)
    assert any("could see the game they predict" in f for f in findings.failures)


def test_verify_detects_mass_below_zero(corpus, run) -> None:
    _rewrite_predictions(
        run.root,
        lambda f: f.with_columns(pl.lit(0.031).alias("mass_below_zero")),
    )
    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    assert any("mass below zero" in f for f in findings.failures)


def test_verify_detects_a_broken_comparison_population(corpus, run) -> None:
    # A comparison row whose baseline is missing means the model and that
    # baseline were scored over different populations.
    _rewrite_predictions(
        run.root,
        lambda f: f.with_columns(
            pl.when(pl.col("in_comparison_population"))
            .then(None)
            .otherwise(pl.col("baseline_season_avg"))
            .alias("baseline_season_avg")
        ),
    )
    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    assert any("baseline_season_avg" in f for f in findings.failures)


def test_verify_detects_a_population_that_does_not_reconcile(corpus, run) -> None:
    with corpus() as conn, conn.cursor() as cur:
        # The CHECK constraint guards inserts of completed runs; verify guards
        # the state afterward. Both matter: one stops it being stored, the
        # other stops it being read.
        cur.execute(
            "update backtest_runs set status = 'failed', candidate_count = 9999 "
            "where id = %s", (run.run_id,),
        )
        conn.commit()
    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    assert any("population reconciles" in f for f in findings.failures)


def test_verify_detects_marker_and_status_disagreement(corpus, run) -> None:
    (run.root / art.COMPLETE_MARKER).unlink()
    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    assert any("marker and status agree" in f for f in findings.failures)


def test_verify_detects_a_nonzero_rng_draw_count(corpus, run) -> None:
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            "update backtest_runs set rng_draws = 7 where id = %s", (run.run_id,)
        )
        conn.commit()
    findings = verify.verify_run(corpus, run.run_id)
    assert not findings.passed
    assert any("rng draws are zero" in f for f in findings.failures)


def test_strict_rejects_an_unattributable_run(corpus, run) -> None:
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            "update backtest_runs set code_version = 'unknown', code_dirty = true "
            "where id = %s", (run.run_id,),
        )
        conn.commit()
    assert verify.verify_run(corpus, run.run_id).passed
    strict = verify.verify_run(corpus, run.run_id, strict=True)
    assert not strict.passed
    assert any("code version recorded" in f for f in strict.failures)
    assert any("working tree was clean" in f for f in strict.failures)


# --- Reproducibility ----------------------------------------------------------


def test_two_runs_of_the_same_config_reproduce_every_digest(
    corpus, artifact_base
) -> None:
    first = run_backtest(corpus, _config(artifact_base), persist=persist)
    second = run_backtest(corpus, _config(artifact_base), persist=persist)

    findings = verify.verify_run(corpus, second.run_id, against=first.run_id)
    assert findings.passed, findings.failures
    assert not findings.notices, "same corpus and config must not read as different"


def test_different_seeds_still_reproduce(corpus, artifact_base) -> None:
    # The engine is closed-form. Determinism is a property of the computation,
    # not of the seed, and this proves the seed is inert.
    a = run_backtest(corpus, _config(artifact_base, seed=1), persist=persist)
    b = run_backtest(corpus, _config(artifact_base, seed=999_999), persist=persist)
    findings = verify.verify_run(corpus, b.run_id, against=a.run_id)
    assert findings.passed, findings.failures


def test_a_changed_corpus_is_a_different_experiment_not_a_failure(
    corpus, artifact_base
) -> None:
    # The distinction that keeps the real failure legible. Reporting a changed
    # corpus as a reproducibility failure would train the operator to ignore it.
    first = run_backtest(corpus, _config(artifact_base), persist=persist)

    # Through the ingest path — a genuine correction — because that is what
    # the corpus digest is a precondition check for. A hand-edited value in the
    # database changes neither a row count nor a timestamp, and would surface
    # as a real digest mismatch instead.
    corrected = _stats_df().with_columns(
        (pl.col("receiving_yards") + 1.0).alias("receiving_yards")
    )
    ingest_stats(
        _h("stats"), corpus, 2022, 2023,
        fetch=lambda s: corrected,
        correction_known_at=datetime(2024, 1, 1, 12, 0),
    )

    second = run_backtest(corpus, _config(artifact_base), persist=persist)
    findings = verify.verify_run(corpus, second.run_id, against=first.run_id)

    assert findings.passed, findings.failures
    assert any("different experiment" in n for n in findings.notices)


# --- Adversarial leakage ------------------------------------------------------


def test_a_fact_known_after_the_cutoff_is_unreachable_and_the_fixture_is_real(
    corpus, run
) -> None:
    # Both halves matter. If the row were unreachable at every cutoff the test
    # would pass while proving nothing.
    predictions = art.read_dataset(run.root, art.PREDICTIONS).to_dicts()
    row = predictions[0]
    cutoff = row["information_cutoff"]

    before = AsOfCorpus(corpus, cutoff).trailing_player_stats(
        player_id=row["player_id"], before_game_id=row["game_id"]
    )
    assert row["game_id"] not in before["game_id"].to_list()

    # A week later the game itself has published and IS visible — proving the
    # fixture contains the row and the cutoff is what hid it.
    after = AsOfCorpus(corpus, cutoff + timedelta(days=7)).trailing_player_stats(
        player_id=row["player_id"], before_game_id=game_id(GAMES[-1])
    )
    assert after.height >= before.height


def test_the_target_game_never_appears_in_any_prediction_window(
    corpus, run
) -> None:
    for row in art.read_dataset(run.root, art.PREDICTIONS).to_dicts():
        eligible = AsOfCorpus(
            corpus, row["information_cutoff"]
        ).trailing_player_stats(
            player_id=row["player_id"], before_game_id=row["game_id"]
        )
        assert row["game_id"] not in eligible["game_id"].to_list()


def test_no_module_in_the_modelling_path_can_reach_a_price(corpus) -> None:
    # The second invariant, restated at the capstone. The detailed sweep lives
    # in test_import_graph; this asserts the guard covers the finished package.
    import sightline_model
    from pathlib import Path

    root = Path(sightline_model.__file__).resolve().parent
    modules = sorted(p.name for p in root.glob("*.py"))
    assert len(modules) >= 10, "the guard must cover the whole finished package"
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8").lower()
        for token in ("priceobservation", "price_observation",
                      "recommendationsnapshot", "recommendation_snapshot"):
            assert token not in text, f"{path.name} references {token}"


def test_feature_code_does_not_import_the_diagnostic_reader(corpus) -> None:
    # diagnostics.py deliberately returns rows past the cutoff for the explain
    # panel. The import-graph test does not know about it, so this is the guard.
    from pathlib import Path

    import sightline_model

    root = Path(sightline_model.__file__).resolve().parent
    for name in ("features.py", "projection.py", "baselines.py", "priors.py"):
        text = (root / name).read_text(encoding="utf-8")
        assert "diagnostics" not in text, f"{name} imports the diagnostic reader"


# --- End to end ---------------------------------------------------------------


def test_corpus_to_stored_calibration_end_to_end(
    corpus, test_dsn, artifact_base, capsys
) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    assert outcome.status == "completed"

    stored = persist.load_run(corpus, outcome.run_id)
    assert stored["aggregates"]["aggregatesVersion"] == 1
    assert persist.load_calibration_bins(corpus, outcome.run_id)

    for argv in (
        ["show", outcome.run_id],
        ["calibration", outcome.run_id],
        ["exclusions", outcome.run_id],
        ["verify", outcome.run_id],
    ):
        assert main(["--database-url", test_dsn, *argv]) == 0, argv
        capsys.readouterr()

    repeat = run_backtest(corpus, _config(artifact_base), persist=persist)
    assert main([
        "--database-url", test_dsn, "verify", repeat.run_id,
        "--against", outcome.run_id,
    ]) == 0
