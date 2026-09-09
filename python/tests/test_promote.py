"""Reviewed promotion tooling for the Simulation Engine (SIG-71, RD-1).

Promotion is the one action that flips a stat type's active model. These tests
attack the invariants that keep it honest:

* **Dry-run writes NOTHING.** Evaluating a promotion prints the intended change
  and touches ``model_selections`` not at all.
* **``--apply`` promotes only the clearing stat types**, and records the evidence
  (backtest run id, Brier delta, sample size) on each promoted row.
* **A stat below the bar stays on the baseline**, untouched, even when another
  stat in the same comparison clears it.

The comparison itself is the tested-elsewhere pure function
``meets_promotion_bar`` / ``compare_stat_type_briers``; here the concern is the
DB-facing apply/dry-run behaviour reading crafted stored aggregates.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import pytest

from sightline_model.simulation.config import SIMULATION_MODEL_VERSION
from sightline_model.simulation.promote import (
    BASELINE_MODEL_VERSION,
    apply_promotions,
    evaluate_promotions,
)

pytestmark = pytest.mark.db

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

# Two stat types: receiving_yards clears the bar comfortably; rushing_yards does
# not (its simulation Brier is worse than the baseline).
_CLEARS = "receiving_yards"
_HOLDS = "rushing_yards"


def _aggregates(briers: dict[str, tuple[float, int]]) -> dict:
    """A minimal aggregates blob carrying the contract-like per-stat Brier block."""
    by_stat = {
        stat: {"thresholds": {"brier": brier, "projections": n}}
        for stat, (brier, n) in briers.items()
    }
    return {"contractLike": {"byStatType": by_stat}}


def _insert_run(cur, *, model_version: str, aggregates: dict, seasons=(2021, 2022)) -> str:
    run_id = str(uuid.uuid4())
    cur.execute(
        "insert into backtest_runs ("
        " id, status, season_from, season_to, season_types, stat_types,"
        " evaluation_window, cutoff_policy, threshold_policy_version,"
        " grading_target, model_version, code_version, seed, rng_draws,"
        " engine_config, engine_config_digest, corpus_digest, aggregates,"
        " aggregates_version, predictions_digest, aggregate_digest,"
        " calibration_digest, artifact_path, started_at, finished_at, updated_at"
        ") values ("
        " %s, 'completed'::\"BacktestStatus\", %s, %s, ARRAY['REG'],"
        " ARRAY['receiving_yards','rushing_yards']::\"StatType\"[],"
        " 'development'::\"EvaluationWindow\", 'kickoff_minus_90m/v1', 'grid-v1',"
        " 'official_corrected', %s, 'testsha', 0, 0, '{}'::jsonb, 'digest',"
        " 'corpus', %s::jsonb, 3, 'pd', 'ad', 'cd', '/tmp/none', now(), now(), now())",
        (run_id, seasons[0], seasons[1], model_version, json.dumps(aggregates)),
    )
    return run_id


_ALL_STAT_TYPES = (
    "passing_yards", "rushing_yards", "receiving_yards",
    "receptions", "rushing_tds", "receiving_tds",
)


def _seed_model_selections(cur) -> None:
    """Upsert all six stat types onto the baseline (the migration's seed shape)."""
    for stat_type in _ALL_STAT_TYPES:
        cur.execute(
            "insert into model_selections (stat_type, model_version, promoted_at, updated_at)"
            " values (%s::\"StatType\", %s, now(), now())"
            " on conflict (stat_type) do update set model_version = excluded.model_version,"
            " backtest_run_id = null, brier_delta = null, sample_size = null, note = null",
            (stat_type, BASELINE_MODEL_VERSION),
        )


@pytest.fixture
def runs(connect, clean_db):
    """A simulation run that beats the baseline on _CLEARS but not on _HOLDS."""
    with connect() as conn, conn.cursor() as cur:
        # model_selections is a seeded registry the full suite may have truncated;
        # upsert every stat to the baseline so a prior test's promotion cannot
        # leak in and a missing row cannot make an UPDATE a silent no-op.
        _seed_model_selections(cur)
        sim = _insert_run(
            cur,
            model_version=SIMULATION_MODEL_VERSION,
            aggregates=_aggregates({_CLEARS: (0.180, 600), _HOLDS: (0.205, 600)}),
        )
        baseline = _insert_run(
            cur,
            model_version=BASELINE_MODEL_VERSION,
            aggregates=_aggregates({_CLEARS: (0.200, 600), _HOLDS: (0.200, 600)}),
        )
        conn.commit()
    return connect, sim, baseline


def _selection(connect, stat_type: str) -> dict:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select model_version, backtest_run_id, brier_delta, sample_size"
            " from model_selections where stat_type = %s::\"StatType\"",
            (stat_type,),
        )
        cols = [d.name for d in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row))


# ---------------------------------------------------------------------------
# Evaluation (pure read)
# ---------------------------------------------------------------------------


def test_evaluate_flags_only_the_clearing_stat(runs) -> None:
    connect, sim, baseline = runs
    candidates = evaluate_promotions(
        connect, simulation_run_id=sim, baseline_run_id=baseline
    )
    by_stat = {c.stat_type: c for c in candidates}
    assert by_stat[_CLEARS].promotes is True
    assert by_stat[_CLEARS].brier_delta == pytest.approx(0.020, abs=1e-9)
    assert by_stat[_HOLDS].promotes is False
    # The simulation is WORSE on the held stat: negative delta.
    assert by_stat[_HOLDS].brier_delta < 0


# ---------------------------------------------------------------------------
# Dry run writes nothing
# ---------------------------------------------------------------------------


def test_dry_run_writes_nothing(runs) -> None:
    connect, sim, baseline = runs
    # Evaluation is pure; a caller that never calls apply_promotions changes
    # nothing. Both stat types remain on the baseline with no evidence recorded.
    evaluate_promotions(connect, simulation_run_id=sim, baseline_run_id=baseline)
    for stat in (_CLEARS, _HOLDS):
        row = _selection(connect, stat)
        assert row["model_version"] == BASELINE_MODEL_VERSION
        assert row["backtest_run_id"] is None
        assert row["brier_delta"] is None


# ---------------------------------------------------------------------------
# Apply promotes only the clearing stat, records evidence
# ---------------------------------------------------------------------------


def test_apply_promotes_only_the_clearing_stat_with_evidence(runs) -> None:
    connect, sim, baseline = runs
    candidates = evaluate_promotions(
        connect, simulation_run_id=sim, baseline_run_id=baseline
    )
    promoted = apply_promotions(
        connect, candidates, simulation_run_id=sim, note="test promotion"
    )
    assert promoted == [_CLEARS]

    clears = _selection(connect, _CLEARS)
    assert clears["model_version"] == SIMULATION_MODEL_VERSION
    assert clears["backtest_run_id"] == sim
    assert float(clears["brier_delta"]) == pytest.approx(0.020, abs=1e-4)
    assert clears["sample_size"] == 600

    # The stat below the bar stays on the baseline, untouched.
    holds = _selection(connect, _HOLDS)
    assert holds["model_version"] == BASELINE_MODEL_VERSION
    assert holds["backtest_run_id"] is None


def test_apply_is_idempotent_on_already_promoted(runs) -> None:
    connect, sim, baseline = runs
    candidates = evaluate_promotions(
        connect, simulation_run_id=sim, baseline_run_id=baseline
    )
    apply_promotions(connect, candidates, simulation_run_id=sim)
    # Re-applying leaves the already-promoted stat on simulation; the second call
    # promotes nothing new.
    promoted_again = apply_promotions(connect, candidates, simulation_run_id=sim)
    assert promoted_again == []
    assert _selection(connect, _CLEARS)["model_version"] == SIMULATION_MODEL_VERSION


def test_evaluate_rejects_a_non_simulation_run_as_the_simulation_arg(runs) -> None:
    connect, sim, baseline = runs
    # Passing the baseline run where the simulation run is expected must fail
    # loudly rather than compare a run to itself.
    with pytest.raises(SystemExit):
        evaluate_promotions(
            connect, simulation_run_id=baseline, baseline_run_id=baseline
        )
