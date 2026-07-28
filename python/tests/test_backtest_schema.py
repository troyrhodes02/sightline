"""Behavioural tests for the backtest result schema (SIG-13).

The schema-invariant tests in ``prisma/tests`` prove the constraints are
*declared*. These prove they *reject*, which is the half that matters: a CHECK
constraint nobody has ever seen fire is a comment with a syntax error waiting
to happen.

Every test here is a negative test. The failure modes being closed are:

* a duplicate calibration segment, which would double-count a bin;
* a multi-axis segment, which the run does not emit and Pitch 6 would not know
  how to read;
* a completed run without its digests, which cannot support the reproducibility
  claim this pitch makes;
* a completed run whose population does not reconcile, which means an aggregate
  was computed over predictions nobody can account for.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import psycopg
import pytest

pytestmark = pytest.mark.db

_RUN_COLUMNS = (
    "id, status, season_from, season_to, season_types, stat_types, "
    "evaluation_window, cutoff_policy, threshold_policy_version, grading_target, "
    "model_version, code_version, seed, engine_config, engine_config_digest, "
    "corpus_digest, candidate_count, projected_count, unprojectable_count, "
    "excluded_count, comparison_count, threshold_obs_count, aggregates_version, "
    "predictions_digest, aggregate_digest, calibration_digest, artifact_path, "
    "started_at, finished_at, updated_at"
)


def insert_run(conn, **overrides) -> str:
    """A stored run. Deliberately explicit: no factory default hides a column.

    Note the timestamps are fixed rather than ``now()`` — a factory that
    defaults a timestamp to the current clock is how a temporal test comes to
    pass for the wrong reason.
    """
    started = datetime(2026, 7, 28, 11, 47, tzinfo=timezone.utc)
    values: dict[str, object] = {
        "id": "3f9c2a10-8e4b-4c17-9d2a-5f1c0b7e6a33",
        "status": "running",
        "season_from": 2019,
        "season_to": 2023,
        "season_types": ["REG"],
        "stat_types": ["rushing_yards", "receiving_yards"],
        "evaluation_window": "development",
        "cutoff_policy": "kickoff_minus_90m/v1",
        "threshold_policy_version": "grid-v1",
        "grading_target": "official_corrected",
        "model_version": "baseline-zil-0.1.0",
        "code_version": "a1b2c3d",
        "seed": 20260728,
        "engine_config": json.dumps({"k0": 4, "trailing_window": 8}),
        "engine_config_digest": "cfg-digest",
        "corpus_digest": "corpus-digest",
        "candidate_count": 0,
        "projected_count": 0,
        "unprojectable_count": 0,
        "excluded_count": 0,
        "comparison_count": 0,
        "threshold_obs_count": 0,
        "aggregates_version": 1,
        "predictions_digest": None,
        "aggregate_digest": None,
        "calibration_digest": None,
        "artifact_path": "python/artifacts/backtests/3f9c2a10",
        "started_at": started,
        "finished_at": None,
        "updated_at": started,
    }
    values.update(overrides)
    cols = [c.strip() for c in _RUN_COLUMNS.split(",")]
    placeholders = ", ".join(f"%({c})s" for c in cols)
    with conn.cursor() as cur:
        cur.execute(
            f"insert into backtest_runs ({', '.join(cols)}) values ({placeholders})",
            values,
        )
    return str(values["id"])


def insert_bin(conn, run_id: str, **overrides) -> None:
    values: dict[str, object] = {
        "id": overrides.pop("id", "bin-" + str(overrides.get("bin_index", 0))),
        "backtest_run_id": run_id,
        "stat_type": None,
        "season": None,
        "era": None,
        "bin_index": 0,
        "bin_low": "0.000",
        "bin_high": "0.100",
        "predicted_mean": "0.04700",
        "observed_rate": "0.06100",
        "threshold_observations": 28440,
        "projection_count": 12208,
        "below_floor": False,
    }
    values.update(overrides)
    cols = list(values)
    placeholders = ", ".join(f"%({c})s" for c in cols)
    with conn.cursor() as cur:
        cur.execute(
            f"insert into calibration_bins ({', '.join(cols)}) values ({placeholders})",
            values,
        )


# --- Calibration segment uniqueness ----------------------------------------


def test_duplicate_all_segment_bin_is_rejected(connect, clean_db) -> None:
    # The one Postgres would let through on the generated unique index alone,
    # because it treats NULLs as distinct.
    with connect() as conn:
        run_id = insert_run(conn)
        insert_bin(conn, run_id, id="bin-a")
        conn.commit()

        with pytest.raises(psycopg.errors.UniqueViolation):
            insert_bin(conn, run_id, id="bin-b")


def test_duplicate_stat_segment_bin_is_rejected(connect, clean_db) -> None:
    with connect() as conn:
        run_id = insert_run(conn)
        insert_bin(conn, run_id, id="bin-a", stat_type="rushing_yards")
        conn.commit()

        with pytest.raises(psycopg.errors.UniqueViolation):
            insert_bin(conn, run_id, id="bin-b", stat_type="rushing_yards")


def test_distinct_segments_and_bins_coexist(connect, clean_db) -> None:
    # The positive case: "all", per stat type, per season, and per era rows for
    # the same bin index are four different segments, not four duplicates.
    with connect() as conn:
        run_id = insert_run(conn)
        insert_bin(conn, run_id, id="bin-all")
        insert_bin(conn, run_id, id="bin-stat", stat_type="rushing_yards")
        insert_bin(conn, run_id, id="bin-season", season=2019)
        insert_bin(conn, run_id, id="bin-era", era="reanalysis")
        insert_bin(conn, run_id, id="bin-all-1", bin_index=1)
        conn.commit()

        with conn.cursor() as cur:
            cur.execute("select count(*) from calibration_bins")
            assert cur.fetchone()[0] == 5


def test_multi_axis_segment_is_rejected(connect, clean_db) -> None:
    # Persisted segments are single-axis; cross-axis slices come from Parquet.
    with connect() as conn:
        run_id = insert_run(conn)
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_bin(conn, run_id, stat_type="rushing_yards", era="reanalysis")


# --- Calibration bounds ------------------------------------------------------


def test_projection_count_may_not_exceed_threshold_observations(
    connect, clean_db
) -> None:
    # Several thresholds are evaluated per projection, so the projection count
    # is always the smaller of the two. The reverse means the two sample sizes
    # have been swapped, which would overstate the effective sample.
    with connect() as conn:
        run_id = insert_run(conn)
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_bin(conn, run_id, threshold_observations=61, projection_count=734)


def test_probability_out_of_range_is_rejected(connect, clean_db) -> None:
    # Catches the percent-vs-proportion unit error, which is invisible once it
    # reaches a chart.
    with connect() as conn:
        run_id = insert_run(conn)
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_bin(conn, run_id, observed_rate="6.10000")


def test_inverted_bin_bounds_are_rejected(connect, clean_db) -> None:
    with connect() as conn:
        run_id = insert_run(conn)
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_bin(conn, run_id, bin_low="0.500", bin_high="0.100")


# --- Run completion invariants ----------------------------------------------


def test_completed_run_without_digests_is_rejected(connect, clean_db) -> None:
    with connect() as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_run(
                conn,
                status="completed",
                finished_at=datetime(2026, 7, 28, 13, 58, tzinfo=timezone.utc),
            )


def test_completed_run_without_finished_at_is_rejected(connect, clean_db) -> None:
    with connect() as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_run(
                conn,
                status="completed",
                predictions_digest="p",
                aggregate_digest="a",
                calibration_digest="c",
                finished_at=None,
            )


def test_completed_run_population_must_reconcile(connect, clean_db) -> None:
    with connect() as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_run(
                conn,
                status="completed",
                candidate_count=19760,
                projected_count=18442,
                unprojectable_count=612,
                excluded_count=1,  # does not reconcile
                predictions_digest="p",
                aggregate_digest="a",
                calibration_digest="c",
                finished_at=datetime(2026, 7, 28, 13, 58, tzinfo=timezone.utc),
            )


def test_comparison_population_may_not_exceed_projected(connect, clean_db) -> None:
    # The comparison population is a subset of successful projections: it drops
    # the ones where a baseline was undefined. Exceeding it means predictions
    # were compared that the model never produced.
    with connect() as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            insert_run(
                conn,
                status="completed",
                candidate_count=100,
                projected_count=80,
                unprojectable_count=10,
                excluded_count=10,
                comparison_count=90,
                predictions_digest="p",
                aggregate_digest="a",
                calibration_digest="c",
                finished_at=datetime(2026, 7, 28, 13, 58, tzinfo=timezone.utc),
            )


def test_reconciling_completed_run_is_accepted(connect, clean_db) -> None:
    with connect() as conn:
        insert_run(
            conn,
            status="completed",
            candidate_count=19760,
            projected_count=18442,
            unprojectable_count=612,
            excluded_count=706,
            comparison_count=17204,
            predictions_digest="p",
            aggregate_digest="a",
            calibration_digest="c",
            finished_at=datetime(2026, 7, 28, 13, 58, tzinfo=timezone.utc),
        )
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("select status from backtest_runs")
            assert cur.fetchone()[0] == "completed"


def test_running_run_needs_no_digests(connect, clean_db) -> None:
    # The constraints bite on `completed` only. A run in flight legitimately
    # has neither digests nor a finished_at, and an incomplete population.
    with connect() as conn:
        insert_run(conn, status="running", candidate_count=500, projected_count=12)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("select status, predictions_digest from backtest_runs")
            assert cur.fetchone() == ("running", None)


def test_interrupted_run_is_storable_and_is_not_a_result(connect, clean_db) -> None:
    with connect() as conn:
        insert_run(
            conn,
            status="interrupted",
            candidate_count=19760,
            projected_count=2104,
            finished_at=datetime(2026, 7, 28, 12, 18, tzinfo=timezone.utc),
        )
        conn.commit()
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from backtest_runs where status = 'completed'"
            )
            assert cur.fetchone()[0] == 0


# --- Structural -------------------------------------------------------------


def test_bins_cascade_with_their_run(connect, clean_db) -> None:
    with connect() as conn:
        run_id = insert_run(conn)
        insert_bin(conn, run_id)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("delete from backtest_runs where id = %s", (run_id,))
            conn.commit()
            cur.execute("select count(*) from calibration_bins")
            assert cur.fetchone()[0] == 0


def test_result_tables_have_no_row_level_security(connect, clean_db) -> None:
    # A decision, not an oversight: these are shared reference data with no
    # per-user partition. If someone enables RLS here they have misread the
    # access model as multi-tenancy, and this test is where they find out.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select relname, relrowsecurity from pg_class "
            "where relname in ('backtest_runs', 'calibration_bins')"
        )
        rows = dict(cur.fetchall())
    assert rows == {"backtest_runs": False, "calibration_bins": False}


def test_result_tables_are_not_bitemporal_fact_tables(connect, clean_db) -> None:
    # A backtest result is a measurement of the model, not a fact about the
    # world. It carries no valid_at/known_at, and no ingest_run_id — so the
    # schema-invariant guard that demands the temporal trio of every ingested
    # table correctly does not apply to it.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select column_name from information_schema.columns "
            "where table_name in ('backtest_runs', 'calibration_bins')"
        )
        columns = {row[0] for row in cur.fetchall()}
    assert not columns & {"valid_at", "known_at", "known_at_reconstructed",
                          "ingest_run_id"}
