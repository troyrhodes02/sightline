"""Pipeline run recording and the scheduled ingest cycle (SIG-46).

GIVEN/WHEN/THEN per case. The properties under attack:

* A cycle row is created ``running`` before work and reaches success only at
  completion — an interrupted cycle stays ``running`` and can never read as a
  success.
* Duplicate scheduled invocation (same ``(category, invocation_id)``) records
  one logical cycle and re-runs nothing.
* Partial success is honest: a failed REQUIRED source fails the cycle while
  the remaining sources still run; a failed OPTIONAL source does not.
* Live ingest ``known_at`` honesty: a later cycle appends new observations and
  never rewrites what an earlier cycle recorded as known.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest

from sightline_ingest.cycle import (
    LOOKAHEAD_DAYS,
    run_cycle,
    upcoming_season_window,
)
from sightline_ingest.pipeline import (
    CATEGORY_INGEST,
    CATEGORY_RECOMPUTE,
    GAME_FAILED,
    GAME_SUCCEEDED,
    RUN_FAILED,
    RUN_RUNNING,
    RUN_SUCCEEDED,
    finish_pipeline_run,
    manual_invocation_id,
    record_pipeline_run_game,
    start_pipeline_run,
)
from sightline_ingest.registry import DATASETS, Dataset

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

NOW = datetime(2025, 11, 7, 9, 0)  # Friday morning before a Sunday slate
KICKOFF = datetime(2025, 11, 9, 18, 0)


def _uid(key: str) -> str:
    return str(uuid.uuid5(_NS, f"test-pipeline-cycle:{key}"))


def _seed_upcoming_game(connect, *, kickoff: datetime = KICKOFF) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into teams (id, nflverse_abbr, full_name, created_at, updated_at)"
            " values (%s,%s,%s,now(),now()), (%s,%s,%s,now(),now())",
            (_uid("team-CIN"), "CIN", "Cincinnati Bengals",
             _uid("team-BAL"), "BAL", "Baltimore Ravens"),
        )
        cur.execute(
            "insert into games (id, season, week, season_type, home_team_id,"
            " away_team_id, is_dome, status, kickoff_at, created_at, updated_at)"
            " values (%s,%s,%s,'REG',%s,%s,false,'scheduled',%s,now(),now())",
            (_uid("game-upcoming"), 2025, 10, _uid("team-BAL"), _uid("team-CIN"),
             kickoff),
        )
        conn.commit()


def _pipeline_runs(connect) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, category, status, invocation_id, scope, error_message,"
            " started_at, finished_at from pipeline_runs order by started_at"
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _ingest_runs(connect) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select dataset, status, pipeline_run_id from ingest_runs order by started_at"
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _fake_dataset(name: str, calls: list[str], *, fail: bool = False) -> Dataset:
    def run(handle, connect, season_from, season_to, /, **_: object) -> None:
        calls.append(name)
        if fail:
            raise RuntimeError(f"{name} exploded")
        handle.rows_written = 1

    return Dataset(name=name, source="nflverse", run=run)


def _install_fakes(monkeypatch, calls: list[str], *, failing: set[str] = frozenset()) -> None:
    for name in ("schedule", "pbp", "stats", "context", "weather"):
        monkeypatch.setitem(
            DATASETS, name, _fake_dataset(name, calls, fail=name in failing)
        )


# ---------------------------------------------------------------------------
# PipelineRun primitives
# ---------------------------------------------------------------------------


@pytest.mark.db
def test_run_row_is_running_before_terminal(connect, clean_db) -> None:
    run_id = start_pipeline_run(
        connect, category=CATEGORY_RECOMPUTE, invocation_id="inv-1", scope="in_week"
    )
    assert run_id is not None
    (row,) = _pipeline_runs(connect)
    assert row["status"] == RUN_RUNNING
    assert row["finished_at"] is None

    finish_pipeline_run(connect, run_id, status=RUN_SUCCEEDED)
    (row,) = _pipeline_runs(connect)
    assert row["status"] == RUN_SUCCEEDED
    assert row["finished_at"] is not None


@pytest.mark.db
def test_duplicate_invocation_records_one_logical_cycle(connect, clean_db) -> None:
    first = start_pipeline_run(
        connect, category=CATEGORY_INGEST, invocation_id="gh-123", scope="in_week"
    )
    second = start_pipeline_run(
        connect, category=CATEGORY_INGEST, invocation_id="gh-123", scope="in_week"
    )
    assert first is not None
    assert second is None, "a re-delivered invocation must not create a second cycle"
    assert len(_pipeline_runs(connect)) == 1

    # A different category may reuse the same invocation id (one workflow run
    # can legitimately drive both an ingest and a recompute cycle).
    other = start_pipeline_run(
        connect, category=CATEGORY_RECOMPUTE, invocation_id="gh-123", scope="in_week"
    )
    assert other is not None


@pytest.mark.db
def test_manual_invocation_ids_never_collide(connect, clean_db) -> None:
    a = start_pipeline_run(
        connect, category=CATEGORY_RECOMPUTE, invocation_id=manual_invocation_id()
    )
    b = start_pipeline_run(
        connect, category=CATEGORY_RECOMPUTE, invocation_id=manual_invocation_id()
    )
    assert a is not None and b is not None
    assert len(_pipeline_runs(connect)) == 2


@pytest.mark.db
def test_game_rows_upsert_within_a_cycle(connect, clean_db) -> None:
    _seed_upcoming_game(connect)
    run_id = start_pipeline_run(
        connect, category=CATEGORY_RECOMPUTE, invocation_id="inv-g"
    )
    game_id = _uid("game-upcoming")
    record_pipeline_run_game(
        connect, run_id, game_id, status=GAME_FAILED, error_message="first try"
    )
    record_pipeline_run_game(
        connect, run_id, game_id, status=GAME_SUCCEEDED, projected_count=4
    )
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select status, projected_count, error_message from pipeline_run_games"
        )
        rows = cur.fetchall()
    assert rows == [(GAME_SUCCEEDED, 4, None)]


# ---------------------------------------------------------------------------
# The ingest cycle
# ---------------------------------------------------------------------------


@pytest.mark.db
def test_cycle_success_links_every_source_to_the_run(connect, clean_db, monkeypatch) -> None:
    _seed_upcoming_game(connect)
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)

    status = run_cycle(connect, invocation_id="gh-1", now=NOW)

    assert status == RUN_SUCCEEDED
    assert calls == ["schedule", "pbp", "stats", "context", "weather"]
    (run,) = _pipeline_runs(connect)
    assert run["status"] == RUN_SUCCEEDED
    assert run["category"] == CATEGORY_INGEST
    ingest = _ingest_runs(connect)
    assert len(ingest) == 5
    assert all(r["pipeline_run_id"] == run["id"] for r in ingest)


@pytest.mark.db
def test_failed_required_source_fails_cycle_but_others_still_run(
    connect, clean_db, monkeypatch
) -> None:
    _seed_upcoming_game(connect)
    calls: list[str] = []
    _install_fakes(monkeypatch, calls, failing={"stats"})

    status = run_cycle(connect, invocation_id="gh-2", now=NOW)

    assert status == RUN_FAILED
    # One outage never conceals another: every source still ran.
    assert calls == ["schedule", "pbp", "stats", "context", "weather"]
    (run,) = _pipeline_runs(connect)
    assert run["status"] == RUN_FAILED
    assert "stats" in (run["error_message"] or "")
    by_dataset = {r["dataset"]: r["status"] for r in _ingest_runs(connect)}
    assert by_dataset["stats"] == "failed"
    assert by_dataset["schedule"] == "success"


@pytest.mark.db
def test_failed_optional_source_still_succeeds_with_detail(
    connect, clean_db, monkeypatch
) -> None:
    _seed_upcoming_game(connect)
    calls: list[str] = []
    _install_fakes(monkeypatch, calls, failing={"weather"})

    status = run_cycle(connect, invocation_id="gh-3", now=NOW)

    assert status == RUN_SUCCEEDED
    (run,) = _pipeline_runs(connect)
    assert run["status"] == RUN_SUCCEEDED
    by_dataset = {r["dataset"]: r["status"] for r in _ingest_runs(connect)}
    # The aggregate is green while the per-source detail stays honest.
    assert by_dataset["weather"] == "failed"


@pytest.mark.db
def test_duplicate_cycle_invocation_runs_nothing(connect, clean_db, monkeypatch) -> None:
    _seed_upcoming_game(connect)
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)

    assert run_cycle(connect, invocation_id="gh-4", now=NOW) == RUN_SUCCEEDED
    first_calls = list(calls)

    assert run_cycle(connect, invocation_id="gh-4", now=NOW) == "duplicate"
    assert calls == first_calls, "a duplicate invocation must not re-run datasets"
    assert len(_pipeline_runs(connect)) == 1
    assert len(_ingest_runs(connect)) == 5


@pytest.mark.db
def test_offseason_cycle_records_nothing(connect, clean_db, monkeypatch) -> None:
    # GIVEN no scheduled game inside the lookahead (offseason)
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)

    status = run_cycle(connect, invocation_id="gh-5", now=NOW)

    assert status == "not_expected"
    assert calls == []
    assert _pipeline_runs(connect) == []
    assert _ingest_runs(connect) == []


@pytest.mark.db
def test_season_window_derives_from_stored_schedule(connect, clean_db) -> None:
    _seed_upcoming_game(connect, kickoff=NOW + timedelta(days=2))
    assert upcoming_season_window(connect, now=NOW) == (2025, 2025)
    # Outside the lookahead: not expected.
    assert (
        upcoming_season_window(connect, now=NOW - timedelta(days=LOOKAHEAD_DAYS + 5))
        is None
    )


@pytest.mark.db
def test_interrupted_cycle_stays_running_never_success(connect, clean_db, monkeypatch) -> None:
    """A killed runner cannot mark its own row: simulate the kill by raising
    KeyboardInterrupt from a source and assert the recorded state is failed —
    and that a row abandoned with no handler at all still reads ``running``,
    never any success state."""
    _seed_upcoming_game(connect)
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)

    def interrupted(handle, connect_, season_from, season_to, /, **_: object) -> None:
        raise KeyboardInterrupt

    monkeypatch.setitem(
        DATASETS, "pbp", Dataset(name="pbp", source="nflverse", run=interrupted)
    )

    with pytest.raises(KeyboardInterrupt):
        run_cycle(connect, invocation_id="gh-6", now=NOW)
    (run,) = _pipeline_runs(connect)
    assert run["status"] == RUN_FAILED  # recorded on the way out, never success

    # An abandoned row (process killed before any handler) stays running.
    abandoned = start_pipeline_run(
        connect, category=CATEGORY_INGEST, invocation_id="gh-7"
    )
    assert abandoned is not None
    rows = {r["invocation_id"]: r["status"] for r in _pipeline_runs(connect)}
    assert rows["gh-7"] == RUN_RUNNING


@pytest.mark.db
def test_second_cycle_appends_and_never_rewrites_known_at(
    connect, clean_db, monkeypatch
) -> None:
    """known_at honesty across cycles: cycle 2 observing a NEW fact appends a
    new observation row; the row cycle 1 recorded keeps its original known_at.
    The constructed attack — re-inserting the same natural key with a newer
    known_at — lands as a new append-only row, not an overwrite."""
    _seed_upcoming_game(connect)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into players (id, full_name, position, created_at, updated_at)"
            " values (%s,%s,%s,now(),now())",
            (_uid("player"), "Ja'Marr Chase", "WR"),
        )
        conn.commit()

    t1 = NOW - timedelta(days=1)
    t2 = NOW

    def context_writer(known_at):
        def run(handle, connect_, season_from, season_to, /, **_: object) -> None:
            with connect_() as conn, conn.cursor() as cur:
                cur.execute(
                    "insert into player_game_context (id, player_id, game_id,"
                    " team_abbr_at_game, context_type, text_value, valid_at,"
                    " known_at, known_at_reconstructed, source, ingest_run_id)"
                    " values (gen_random_uuid(),%s,%s,'CIN','injury_designation',"
                    " 'Questionable',%s,%s,false,'nflverse',%s)"
                    " on conflict (player_id, game_id, context_type, known_at, source)"
                    " do nothing",
                    (_uid("player"), _uid("game-upcoming"), known_at, known_at,
                     handle.run_id),
                )
                conn.commit()
            handle.rows_written = 1

        return run

    calls: list[str] = []
    _install_fakes(monkeypatch, calls)
    monkeypatch.setitem(
        DATASETS, "context",
        Dataset(name="context", source="nflverse", run=context_writer(t1)),
    )
    assert run_cycle(connect, invocation_id="gh-8", now=NOW) == RUN_SUCCEEDED

    monkeypatch.setitem(
        DATASETS, "context",
        Dataset(name="context", source="nflverse", run=context_writer(t2)),
    )
    assert run_cycle(connect, invocation_id="gh-9", now=NOW) == RUN_SUCCEEDED

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select known_at from player_game_context order by known_at"
        )
        known_ats = [r[0] for r in cur.fetchall()]
    assert known_ats == [t1, t2], (
        "cycle 2 must append a new observation; cycle 1's known_at is immutable"
    )
