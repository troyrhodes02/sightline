"""Projection persistence (SIG-41): scope, leakage, and idempotence.

The structural tests prove the contract read touches identity columns only —
the price columns are not merely unused, they are unreferenced. The DB tests
attack the two properties that matter: a re-run writes nothing, and a fact
published after the cutoff cannot move a projection computed at that cutoff.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from sightline_model.project_live import (
    _CANDIDATES_SQL,
    PostKickoffComputation,
    _assert_pre_kickoff_freeze,
    _parse_cutoff,
    projection_row_id,
    run_project,
)


@pytest.fixture(autouse=True)
def _isolate_simulation_models(monkeypatch, tmp_path):
    """Keep these baseline-focused tests independent of staged simulation models.

    ``run_project`` runs the simulation engine in shadow for every stat it
    supports (SIG-103), loading artefacts from ``default_models_dir`` — a real,
    process-wide path. When those artefacts happen to be fitted and staged on
    disk (e.g. after a human-run fit), the shadow engine adds a second
    projection per candidate and these baseline-count assertions break through
    no fault of the code under test. Pointing ``SIGHTLINE_SIM_MODELS_DIR`` at an
    empty directory makes the live path degrade to baseline-only, exactly as it
    does in a clean environment, so the tests are deterministic either way.
    Tests that specifically exercise the simulation shadow live elsewhere and
    stage their own models.
    """
    empty = tmp_path / "no-simulation-models"
    empty.mkdir()
    monkeypatch.setenv("SIGHTLINE_SIM_MODELS_DIR", str(empty))

# ---------------------------------------------------------------------------
# Structural: identity columns only (spec RD-15)
# ---------------------------------------------------------------------------


def test_candidate_sql_reads_identity_columns_only() -> None:
    referenced = set(re.findall(r"\bc\.(\w+)", _CANDIDATES_SQL))
    assert referenced <= {
        "player_id",
        "game_id",
        "stat_type",
        "resolution_status",
    }, f"contract read must stay identity-only, found: {sorted(referenced)}"


def test_candidate_sql_touches_no_market_history_table() -> None:
    lowered = _CANDIDATES_SQL.lower()
    assert "price" not in lowered
    assert "snapshot" not in lowered
    assert "decision" not in lowered


# ---------------------------------------------------------------------------
# Unit: deterministic ids, cutoff parsing
# ---------------------------------------------------------------------------


def test_projection_row_id_is_deterministic_and_key_sensitive() -> None:
    cutoff = datetime(2026, 11, 6, 14, 0)
    a = projection_row_id("p1", "g1", "receiving_yards", "baseline-zil-0.1.0", cutoff)
    b = projection_row_id("p1", "g1", "receiving_yards", "baseline-zil-0.1.0", cutoff)
    assert a == b
    assert a != projection_row_id("p2", "g1", "receiving_yards", "baseline-zil-0.1.0", cutoff)
    assert a != projection_row_id(
        "p1", "g1", "receiving_yards", "baseline-zil-0.1.0", cutoff + timedelta(hours=1)
    )


def test_parse_cutoff_requires_a_timezone() -> None:
    with pytest.raises(SystemExit):
        _parse_cutoff("2026-11-06T14:00:00")
    parsed = _parse_cutoff("2026-11-06T14:00:00+00:00")
    assert parsed.tzinfo is None  # normalised to naive UTC, the corpus convention


# ---------------------------------------------------------------------------
# Temporal integrity, backfilling form (SIG-103, spec D3)
# ---------------------------------------------------------------------------


def test_kickoff_freeze_guard_blocks_a_post_kickoff_computation() -> None:
    kickoff = datetime(2025, 11, 9, 18, 0)
    # Computed after the ball is kicked: not a pre-game prediction, never live.
    with pytest.raises(PostKickoffComputation):
        _assert_pre_kickoff_freeze(kickoff + timedelta(minutes=1), kickoff, "g1")
    # Computed exactly at kickoff is also refused — the freeze is the boundary.
    with pytest.raises(PostKickoffComputation):
        _assert_pre_kickoff_freeze(kickoff, kickoff, "g1")


def test_kickoff_freeze_guard_allows_a_pre_kickoff_computation() -> None:
    kickoff = datetime(2025, 11, 9, 18, 0)
    # A minute before kickoff is live evidence; the guard is silent.
    _assert_pre_kickoff_freeze(kickoff - timedelta(minutes=1), kickoff, "g1")


# ---------------------------------------------------------------------------
# DB integration: seed, project, attack
# ---------------------------------------------------------------------------

pytestmark_db = pytest.mark.db

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _uid(key: str) -> str:
    return str(uuid.uuid5(_NS, f"test-project-live:{key}"))


# Cutoff for every scenario: a Friday afternoon before a Sunday slate.
CUTOFF = datetime(2025, 11, 7, 18, 0)
NOW = CUTOFF
KICKOFF_UPCOMING = datetime(2025, 11, 9, 18, 0)


def _seed(connect, *, with_late_game: bool = False) -> None:
    """A minimal corpus: one player with history, one upcoming contract.

    ``with_late_game`` adds a completed game whose stat line is PUBLISHED
    AFTER the cutoff (kickoff the evening before; stats publish 09:00 ET the
    next day, which is past an 18:00 UTC Friday cutoff only if the game was
    Thursday night — so the late game kicks off Thursday 2025-11-06 evening
    ET, publishing Friday 09:00 ET = 14:00 UTC... which is BEFORE the cutoff.
    To postdate the cutoff the game must kick off Friday evening: published
    Saturday 09:00 ET, after the Friday-18:00-UTC cutoff.)
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into teams (id, nflverse_abbr, full_name, created_at, updated_at)"
            " values (%s,%s,%s,now(),now()), (%s,%s,%s,now(),now())",
            (_uid("team-CIN"), "CIN", "Cincinnati Bengals",
             _uid("team-BAL"), "BAL", "Baltimore Ravens"),
        )
        cur.execute(
            "insert into players (id, full_name, position, created_at, updated_at)"
            " values (%s,%s,%s,now(),now())",
            (_uid("player"), "Ja'Marr Chase", "WR"),
        )

        def game(key: str, season: int, week: int, kickoff: datetime, status: str) -> None:
            cur.execute(
                "insert into games (id, season, week, season_type, home_team_id,"
                " away_team_id, is_dome, status, kickoff_at, created_at, updated_at)"
                " values (%s,%s,%s,'REG',%s,%s,false,%s::\"GameStatus\",%s,now(),now())",
                (_uid(key), season, week, _uid("team-BAL"), _uid("team-CIN"),
                 status, kickoff),
            )

        def stat(key: str, game_key: str, yards: float, known_at: datetime) -> None:
            cur.execute(
                "insert into player_game_stats (id, player_id, game_id,"
                " team_abbr_at_game, receiving_yards, version, valid_at, known_at,"
                " known_at_reconstructed, source, ingest_run_id, created_at, updated_at)"
                " values (%s,%s,%s,'CIN',%s,1,%s,%s,true,'nflverse',%s,now(),now())",
                (_uid(key), _uid("player"), _uid(game_key), yards,
                 known_at, known_at, _uid("ingest-run")),
            )

        # Prior-season evidence (2024) so fit_prior has pre-2025 rows.
        for week, yards in ((1, 88.0), (2, 61.0), (3, 74.0)):
            key = f"game-2024-w{week}"
            kickoff = datetime(2024, 9, 1 + week * 7, 17, 0)
            game(key, 2024, week, kickoff, "completed")
            stat(f"stat-2024-w{week}", key, yards, kickoff + timedelta(days=1))

        # Current-season history, all published well before the cutoff.
        for week, yards in ((1, 95.0), (2, 42.0), (3, 110.0), (4, 71.0)):
            key = f"game-2025-w{week}"
            kickoff = datetime(2025, 9, 1 + week * 7, 17, 0)
            game(key, 2025, week, kickoff, "completed")
            stat(f"stat-2025-w{week}", key, yards, kickoff + timedelta(days=1))

        if with_late_game:
            # Kicks off Friday 2025-11-07 23:00 UTC (6pm ET): stats publish
            # Saturday 09:00 ET (14:00 UTC), which POSTDATES the Friday
            # 18:00 UTC cutoff. Visible only to a later cutoff.
            late_kickoff = datetime(2025, 11, 7, 23, 0)
            game("game-late", 2025, 9, late_kickoff, "completed")
            stat("stat-late", "game-late", 240.0, late_kickoff + timedelta(hours=15))

        # The upcoming game and its resolved contract.
        game("game-upcoming", 2025, 10, KICKOFF_UPCOMING, "scheduled")
        cur.execute(
            "insert into contracts (id, kalshi_ticker, title, kalshi_player_name,"
            " player_id, game_id, stat_type, threshold, resolution_status, status,"
            " first_seen_at, last_seen_at, created_at, updated_at)"
            " values (%s,%s,%s,%s,%s,%s,%s::\"StatType\",%s,"
            " 'resolved'::\"IdentityResolutionStatus\", 'active'::\"ContractStatus\","
            " now(), now(), now(), now())",
            (_uid("contract"), "KXNFLRECYDS-25NOV09CINBAL-JC-74.5",
             "Ja'Marr Chase: 75+ receiving yards", "Ja'Marr Chase",
             _uid("player"), _uid("game-upcoming"), "receiving_yards", 74.5),
        )
        conn.commit()


def _projection_rows(connect) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, params, computed_at, information_cutoff from projections"
            " order by id"
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


@pytest.mark.db
def test_project_writes_projection_and_drivers(connect, clean_db, monkeypatch) -> None:
    _seed(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    totals = run_project(CUTOFF, now=NOW)
    assert totals["projected"] == 1

    rows = _projection_rows(connect)
    assert len(rows) == 1
    assert rows[0]["information_cutoff"] == CUTOFF

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select rank, text from projection_drivers where projection_id = %s"
            " order by rank",
            (rows[0]["id"],),
        )
        drivers = cur.fetchall()
    assert len(drivers) > 0
    assert [r[0] for r in drivers] == list(range(len(drivers)))


@pytest.mark.db
def test_rerun_with_same_cutoff_changes_nothing(connect, clean_db, monkeypatch) -> None:
    _seed(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    run_project(CUTOFF, now=NOW)
    before = _projection_rows(connect)

    # A later wall clock, same cutoff: idempotence means no new rows AND the
    # original computed_at survives.
    run_project(CUTOFF, now=NOW + timedelta(hours=3))
    after = _projection_rows(connect)

    assert after == before


# ---------------------------------------------------------------------------
# Pipeline run recording (SIG-46): per-game outcomes, scoping, dedup
# ---------------------------------------------------------------------------


def _seed_second_game(connect) -> None:
    """A second upcoming game + contract for the same player (late window)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into games (id, season, week, season_type, home_team_id,"
            " away_team_id, is_dome, status, kickoff_at, created_at, updated_at)"
            " values (%s,%s,%s,'REG',%s,%s,false,'scheduled',%s,now(),now())",
            (_uid("game-upcoming-2"), 2025, 10, _uid("team-CIN"), _uid("team-BAL"),
             KICKOFF_UPCOMING + timedelta(hours=7)),
        )
        cur.execute(
            "insert into contracts (id, kalshi_ticker, title, kalshi_player_name,"
            " player_id, game_id, stat_type, threshold, resolution_status, status,"
            " first_seen_at, last_seen_at, created_at, updated_at)"
            " values (%s,%s,%s,%s,%s,%s,%s::\"StatType\",%s,"
            " 'resolved'::\"IdentityResolutionStatus\", 'active'::\"ContractStatus\","
            " now(), now(), now(), now())",
            (_uid("contract-2"), "KXNFLRECYDS-25NOV09BALCIN-JC-89.5",
             "Ja'Marr Chase: 90+ receiving yards", "Ja'Marr Chase",
             _uid("player"), _uid("game-upcoming-2"), "receiving_yards", 89.5),
        )
        conn.commit()


def _run_rows(connect) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, category, status, scope, invocation_id from pipeline_runs"
            " order by started_at"
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _game_rows(connect) -> dict[str, dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select game_id, status, projected_count, error_message"
            " from pipeline_run_games"
        )
        cols = [d.name for d in cur.description]
        return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}


@pytest.mark.db
def test_project_records_run_and_per_game_outcomes(connect, clean_db, monkeypatch) -> None:
    _seed(connect)
    _seed_second_game(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    totals = run_project(CUTOFF, now=NOW, invocation_id="gh-100")

    assert totals["projected"] == 2
    (run,) = _run_rows(connect)
    assert run["category"] == "recompute"
    assert run["status"] == "succeeded"
    assert run["scope"] == "in_week"
    games = _game_rows(connect)
    assert len(games) == 2
    assert all(g["status"] == "succeeded" for g in games.values())
    assert games[_uid("game-upcoming")]["projected_count"] == 1


@pytest.mark.db
def test_games_scoping_projects_only_selected_games(connect, clean_db, monkeypatch) -> None:
    _seed(connect)
    _seed_second_game(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    totals = run_project(
        CUTOFF, now=NOW, games=[_uid("game-upcoming")], invocation_id="gh-101"
    )

    assert totals["projected"] == 1
    (run,) = _run_rows(connect)
    assert run["scope"] == "gameday"
    games = _game_rows(connect)
    assert set(games) == {_uid("game-upcoming")}, (
        "a scoped recompute must not touch (or record) unselected games"
    )


@pytest.mark.db
def test_one_failed_game_fails_cycle_but_not_other_games(
    connect, clean_db, monkeypatch
) -> None:
    from sightline_model.project_live import run_project as _run
    import sightline_model.project_live as pl

    _seed(connect)
    _seed_second_game(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    real_project_one = pl.project_one
    bad_game = _uid("game-upcoming-2")

    def failing_project_one(history, **kwargs):
        if kwargs.get("game_id") == bad_game:
            raise RuntimeError("engine exploded for this game")
        return real_project_one(history, **kwargs)

    monkeypatch.setattr("sightline_model.project_live.project_one", failing_project_one)

    totals = _run(CUTOFF, now=NOW, invocation_id="gh-102")

    assert totals["projected"] == 1
    assert totals["failed_games"] == 1
    (run,) = _run_rows(connect)
    assert run["status"] == "failed"
    games = _game_rows(connect)
    assert games[_uid("game-upcoming")]["status"] == "succeeded"
    assert games[bad_game]["status"] == "failed"
    # The healthy game's projections were committed (per-game transaction).
    assert len(_projection_rows(connect)) == 1


@pytest.mark.db
def test_duplicate_recompute_invocation_records_and_writes_nothing(
    connect, clean_db, monkeypatch
) -> None:
    _seed(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    run_project(CUTOFF, now=NOW, invocation_id="gh-103")
    before_rows = _projection_rows(connect)

    totals = run_project(CUTOFF, now=NOW, invocation_id="gh-103")

    assert totals["projected"] == 0
    assert _projection_rows(connect) == before_rows
    assert len(_run_rows(connect)) == 1, "one logical cycle for one invocation id"


@pytest.mark.db
def test_empty_candidate_set_is_a_success(connect, clean_db, monkeypatch) -> None:
    # GIVEN a corpus with no resolved contracts at all
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    totals = run_project(CUTOFF, now=NOW, invocation_id="gh-104")

    assert totals["projected"] == 0
    (run,) = _run_rows(connect)
    assert run["status"] == "succeeded", "no-new-data success is a valid success"


@pytest.mark.db
def test_post_kickoff_computation_is_never_stored_as_live(
    connect, clean_db, monkeypatch
) -> None:
    """A recompute whose wall clock is at/after kickoff cannot honestly produce a
    live projection for that game: the game is skipped and nothing is stored, so
    the comparison read (SIG-104) can rely on computed_at < kickoff freeze for
    every stored live projection. Cutoff stays pre-kickoff so ONLY the
    computation-time guard is under test, not the cutoff skip."""
    _seed(connect)
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    # A cutoff before kickoff (honest information horizon) but a `now` past
    # kickoff — the exact shape of a backfill recomputing after the game. The
    # candidate query excludes a game whose kickoff has passed (`kickoff_at >
    # now`), and the per-game computed_at guard is the second, independent line
    # of defence (unit-tested directly). Either way the invariant that matters
    # holds: NOTHING is stored as a live projection for a passed kickoff.
    post_kickoff_now = KICKOFF_UPCOMING + timedelta(hours=1)
    totals = run_project(CUTOFF, now=post_kickoff_now, invocation_id="gh-postkick")

    assert totals["projected"] == 0
    assert _projection_rows(connect) == [], (
        "a post-kickoff computation was stored as a live projection"
    )
    # A pre-kickoff computation of the SAME slate DOES store the projection —
    # proving the gate is the kickoff freeze, not some unrelated exclusion.
    run_project(CUTOFF, now=NOW, invocation_id="gh-postkick-pre")
    assert len(_projection_rows(connect)) == 1, (
        "a pre-kickoff computation should store the live projection"
    )


@pytest.mark.db
def test_post_cutoff_fact_cannot_move_the_projection(connect, clean_db, monkeypatch) -> None:
    """The adversarial pair: construct the leak, prove it is blocked.

    A 240-yard game published after the cutoff must be invisible to a run AT
    the cutoff — parameters identical with or without it in the corpus — and
    visible to a run at a later cutoff, proving the cutoff (not luck) is what
    gated it.
    """
    monkeypatch.setattr("sightline_model.project_live.connect", connect)

    _seed(connect, with_late_game=False)
    run_project(CUTOFF, now=NOW)
    baseline = _projection_rows(connect)[0]["params"]

    # Reset and reseed WITH the post-cutoff game.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "truncate projections, projection_drivers, contracts, player_game_stats,"
            " games, players, teams cascade"
        )
        conn.commit()
    _seed(connect, with_late_game=True)

    run_project(CUTOFF, now=NOW + timedelta(minutes=5))
    at_cutoff = _projection_rows(connect)[0]["params"]
    assert at_cutoff == baseline, (
        "a stat line published after the cutoff reached the projection"
    )

    # The same corpus at a Sunday-morning cutoff DOES see the Friday game.
    later_cutoff = datetime(2025, 11, 9, 15, 0)
    run_project(later_cutoff, now=later_cutoff)
    rows = _projection_rows(connect)
    later = [r for r in rows if r["information_cutoff"] == later_cutoff]
    assert len(later) == 1
    assert later[0]["params"] != baseline, (
        "a later cutoff should see the new game; if not, the gate is not the cutoff"
    )
