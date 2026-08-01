"""The game-day dispatcher (SIG-50): selection, RD-24, and phase recording.

GIVEN/WHEN/THEN per case. The properties under attack:

* Selection re-reads the STORED schedule at evaluation time — kickoff-relative,
  so a flexed game follows its updated kickoff at the next tick (RD-Q12).
* Nothing selected ⇒ nothing written (RD-24): no run rows, no ingest, no
  recompute — a dormant tick is not a pipeline event.
* A dispatch runs the game-day ingest pass (schedule + context required,
  weather optional; never pbp/stats) and a game-scoped recompute, both
  recorded, both deduplicating on the shared invocation id.
* A failed required game-day source fails the tick's exit code while the
  recompute still runs against the last good facts.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta

import pytest

from sightline_ingest.pipeline import (
    CATEGORY_INGEST,
    CATEGORY_RECOMPUTE,
    RUN_FAILED,
    RUN_SUCCEEDED,
    SCOPE_GAMEDAY,
)
from sightline_ingest.registry import DATASETS, Dataset
from sightline_model.gameday import (
    GAMEDAY_WINDOW_MINUTES,
    _WINDOW_GAMES_SQL,
    run_gameday,
    select_window_games,
)

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

NOW = datetime(2025, 11, 9, 14, 0)  # Sunday morning before the early window


def _uid(key: str) -> str:
    return str(uuid.uuid5(_NS, f"test-gameday:{key}"))


def _seed_game(connect, key: str, *, kickoff: datetime, status: str = "scheduled") -> str:
    game_id = _uid(f"game-{key}")
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into teams (id, nflverse_abbr, full_name, created_at, updated_at)"
            " values (%s,%s,%s,now(),now()), (%s,%s,%s,now(),now())"
            " on conflict (nflverse_abbr) do nothing",
            (_uid(f"team-h-{key}"), f"H{key[:2].upper()}", f"Home {key}",
             _uid(f"team-a-{key}"), f"A{key[:2].upper()}", f"Away {key}"),
        )
        cur.execute(
            "insert into games (id, season, week, season_type, home_team_id,"
            " away_team_id, is_dome, status, kickoff_at, created_at, updated_at)"
            " values (%s,%s,%s,'REG',%s,%s,false,%s,%s,now(),now())",
            (game_id, 2025, 10, _uid(f"team-h-{key}"), _uid(f"team-a-{key}"),
             status, kickoff),
        )
        conn.commit()
    return game_id


def _pipeline_runs(connect) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select category, status, invocation_id, scope from pipeline_runs"
            " order by started_at"
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _install_fakes(monkeypatch, calls: list[str], *, failing: set[str] = frozenset()) -> None:
    def fake(name: str) -> Dataset:
        def run(handle, connect_, season_from, season_to, /, **_: object) -> None:
            calls.append(name)
            if name in failing:
                raise RuntimeError(f"{name} exploded")
            handle.rows_written = 1

        return Dataset(name=name, source="nflverse", run=run)

    for name in ("schedule", "pbp", "stats", "context", "weather"):
        monkeypatch.setitem(DATASETS, name, fake(name))


# ---------------------------------------------------------------------------
# Structural: the selection query reads the schedule and nothing else
# ---------------------------------------------------------------------------


def test_selection_sql_reads_games_only() -> None:
    lowered = _WINDOW_GAMES_SQL.lower()
    assert "price" not in lowered
    assert "snapshot" not in lowered
    assert re.search(r"\bfrom\s+games\b", lowered)
    assert "join" not in lowered


def test_window_mirrors_the_ts_gameday_window() -> None:
    # health/config.ts GAMEDAY_WINDOW_HOURS = 6; the two sides must agree or
    # /health will call a healthy dispatcher late (or vice versa).
    assert GAMEDAY_WINDOW_MINUTES == 6 * 60


# ---------------------------------------------------------------------------
# Selection: kickoff-relative, from the stored schedule, at evaluation time
# ---------------------------------------------------------------------------


@pytest.mark.db
def test_selects_only_scheduled_games_inside_the_window(connect, clean_db) -> None:
    inside = _seed_game(connect, "inside", kickoff=NOW + timedelta(hours=3))
    _seed_game(connect, "later", kickoff=NOW + timedelta(hours=7))
    _seed_game(connect, "kicked", kickoff=NOW - timedelta(hours=1))
    _seed_game(connect, "postponed", kickoff=NOW + timedelta(hours=2), status="postponed")

    selected = select_window_games(connect, now=NOW, window_minutes=360)
    assert selected == [inside]


@pytest.mark.db
def test_flexed_kickoff_is_honored_at_next_evaluation(connect, clean_db) -> None:
    game_id = _seed_game(connect, "flexed", kickoff=NOW + timedelta(hours=3))
    assert select_window_games(connect, now=NOW, window_minutes=360) == [game_id]

    # The game flexes to prime time: the same tick-time no longer selects it.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update games set kickoff_at = %s where id = %s",
            (NOW + timedelta(hours=10), game_id),
        )
        conn.commit()
    assert select_window_games(connect, now=NOW, window_minutes=360) == []


# ---------------------------------------------------------------------------
# RD-24: nothing selected, nothing written
# ---------------------------------------------------------------------------


@pytest.mark.db
def test_empty_selection_writes_nothing(connect, clean_db, monkeypatch) -> None:
    _seed_game(connect, "later", kickoff=NOW + timedelta(hours=12))
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    exit_code = run_gameday(connect, invocation_id="gh-gd-0", now=NOW)

    assert exit_code == 0
    assert calls == [], "no ingest may run on an empty selection"
    assert _pipeline_runs(connect) == []


# ---------------------------------------------------------------------------
# Dispatch: both phases recorded, gameday-scoped
# ---------------------------------------------------------------------------


@pytest.mark.db
def test_dispatch_records_gameday_ingest_and_recompute(
    connect, clean_db, monkeypatch
) -> None:
    _seed_game(connect, "inside", kickoff=NOW + timedelta(hours=3))
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    exit_code = run_gameday(connect, invocation_id="gh-gd-1", now=NOW)

    assert exit_code == 0
    # The game-day ingest pass: fast-moving pre-kickoff facts only.
    assert calls == ["schedule", "context", "weather"], (
        "pbp and stats move nightly, never inside a kickoff window"
    )
    runs = _pipeline_runs(connect)
    assert [(r["category"], r["status"], r["scope"]) for r in runs] == [
        (CATEGORY_INGEST, RUN_SUCCEEDED, SCOPE_GAMEDAY),
        (CATEGORY_RECOMPUTE, RUN_SUCCEEDED, SCOPE_GAMEDAY),
    ]
    assert all(r["invocation_id"] == "gh-gd-1" for r in runs)


@pytest.mark.db
def test_duplicate_dispatch_invocation_is_a_structural_noop(
    connect, clean_db, monkeypatch
) -> None:
    _seed_game(connect, "inside", kickoff=NOW + timedelta(hours=3))
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    assert run_gameday(connect, invocation_id="gh-gd-2", now=NOW) == 0
    first = list(calls)
    assert run_gameday(connect, invocation_id="gh-gd-2", now=NOW) == 0

    assert calls == first, "a re-delivered invocation must not re-run ingest"
    assert len(_pipeline_runs(connect)) == 2  # one ingest + one recompute, once


@pytest.mark.db
def test_failed_required_gameday_source_fails_the_tick_but_recompute_runs(
    connect, clean_db, monkeypatch
) -> None:
    _seed_game(connect, "inside", kickoff=NOW + timedelta(hours=3))
    calls: list[str] = []
    _install_fakes(monkeypatch, calls, failing={"context"})
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    exit_code = run_gameday(connect, invocation_id="gh-gd-3", now=NOW)

    assert exit_code == 1
    runs = {r["category"]: r for r in _pipeline_runs(connect)}
    assert runs[CATEGORY_INGEST]["status"] == RUN_FAILED
    # The recompute still ran (last good facts, honest cutoff) and recorded.
    assert runs[CATEGORY_RECOMPUTE]["status"] == RUN_SUCCEEDED


@pytest.mark.db
def test_recompute_cutoff_is_read_after_the_ingest_pass(
    connect, clean_db, monkeypatch
) -> None:
    """A fact whose ``known_at`` lands while the ingest pass runs must be
    inside this tick's recompute cutoff — on the last tick before kickoff it
    would otherwise never be recomputed at all (PR #44 review)."""
    _seed_game(connect, "cutoff", kickoff=NOW + timedelta(hours=3))
    calls: list[str] = []
    _install_fakes(monkeypatch, calls)

    post_ingest = NOW + timedelta(minutes=7)
    monkeypatch.setattr("sightline_model.gameday._now", lambda: post_ingest)

    seen: dict[str, datetime] = {}

    def spy(cutoff: datetime, **_: object) -> dict[str, int]:
        seen["cutoff"] = cutoff
        return {"failed_games": 0}

    monkeypatch.setattr("sightline_model.project_live.run_project", spy)

    assert run_gameday(connect, invocation_id="gh-gd-5", now=NOW) == 0
    assert seen["cutoff"] == post_ingest, (
        "the recompute cutoff must be read after the ingest pass, not at tick start"
    )


@pytest.mark.db
def test_failed_optional_weather_does_not_fail_the_tick(
    connect, clean_db, monkeypatch
) -> None:
    _seed_game(connect, "inside", kickoff=NOW + timedelta(hours=3))
    calls: list[str] = []
    _install_fakes(monkeypatch, calls, failing={"weather"})
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    exit_code = run_gameday(connect, invocation_id="gh-gd-4", now=NOW)

    assert exit_code == 0
    runs = {r["category"]: r for r in _pipeline_runs(connect)}
    assert runs[CATEGORY_INGEST]["status"] == RUN_SUCCEEDED
