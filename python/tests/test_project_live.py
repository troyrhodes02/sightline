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
    _parse_cutoff,
    projection_row_id,
    run_project,
)

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
