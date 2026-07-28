"""Reference ingest: teams, players, and schedule with revision handling.

Uses injected Polars fixtures (no network). Requires a database.
"""

from __future__ import annotations

from datetime import datetime

import polars as pl
import pytest

from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ScheduleError, ingest_schedule
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.errors import SchemaDriftError
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db


def _handle(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "team_abbr": ["KC", "DET"],
            "team_name": ["Kansas City Chiefs", "Detroit Lions"],
            "team_conf": ["AFC", "NFC"],
            "team_division": ["AFC West", "NFC North"],
        }
    )


def _players_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "gsis_id": ["00-0033873", "00-0036355", None],
            "display_name": ["Patrick Mahomes", "Amon-Ra St. Brown", "No Id Guy"],
            "position": ["QB", "WR", "RB"],
            "birth_date": ["1995-09-17", "1999-10-05", None],
            # latest_team is present upstream but must never be stored on Player.
            "latest_team": ["KC", "DET", "KC"],
        }
    )


def _schedule_df(*, gametime: str = "20:20", result=None) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "game_id": ["2023_01_DET_KC"],
            "season": [2023],
            "week": [1],
            "game_type": ["REG"],
            "gameday": ["2023-09-07"],
            "gametime": [gametime],
            "home_team": ["KC"],
            "away_team": ["DET"],
            "roof": ["outdoors"],
            "stadium": ["GEHA Field at Arrowhead Stadium"],
            "location": ["Home"],
            "result": [result],
        }
    )


# --- Teams -----------------------------------------------------------------

def test_teams_ingest_is_idempotent(connect, clean_db) -> None:
    h1 = _handle("teams")
    ingest_teams(h1, connect, fetch=_teams_df)
    assert h1.rows_written == 2

    h2 = _handle("teams")
    ingest_teams(h2, connect, fetch=_teams_df)
    assert (h2.rows_written, h2.rows_updated) == (0, 0)  # no dup, no change

    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from teams")
        assert cur.fetchone()[0] == 2


# --- Players ---------------------------------------------------------------

def test_players_ingest_stable_identity_and_no_current_team(connect, clean_db) -> None:
    ingest_teams(_handle("teams"), connect, fetch=_teams_df)

    h1 = _handle("players")
    ingest_players(h1, connect, fetch=_players_df)
    # Two real players; the null-gsis row is skipped and flagged partial.
    assert h1.rows_written == 2
    assert h1.status == "partial"

    with connect() as conn, conn.cursor() as cur:
        cur.execute("select id, full_name from players order by full_name")
        rows = cur.fetchall()
        # display_name maps to full_name.
        assert [r[1] for r in rows] == ["Amon-Ra St. Brown", "Patrick Mahomes"]
        # Deterministic, stable identity keyed off gsis_id.
        cur.execute("select id from players where full_name = 'Patrick Mahomes'")
        assert cur.fetchone()[0] == player_id("00-0033873")
        # Structural: Player carries no current-team column to leak from.
        cur.execute(
            "select column_name from information_schema.columns "
            "where table_name = 'players'"
        )
        cols = {r[0] for r in cur.fetchall()}
    assert not (cols & {"latest_team", "team", "team_id", "current_team_id"})

    # Re-ingest is idempotent (same deterministic ids).
    h2 = _handle("players")
    ingest_players(h2, connect, fetch=_players_df)
    assert (h2.rows_written, h2.rows_updated) == (0, 0)


# --- Schedule + revisions --------------------------------------------------

def test_schedule_initial_load_and_revision_recoverable_as_of(connect, clean_db) -> None:
    ingest_teams(_handle("teams"), connect, fetch=_teams_df)
    gid = game_id("2023_01_DET_KC")

    # Initial load: one game, one (initial) revision.
    ingest_schedule(_handle("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select kickoff_at from games where id = %s", (gid,))
        original_kickoff = cur.fetchone()[0]
        cur.execute("select count(*) from game_schedule_revisions where game_id = %s", (gid,))
        assert cur.fetchone()[0] == 1

    # Re-ingest identical schedule: no new revision, no mutation.
    h_same = _handle("schedule")
    ingest_schedule(h_same, connect, 2023, 2023, fetch=lambda s: _schedule_df())
    assert (h_same.rows_written, h_same.rows_updated) == (0, 0)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from game_schedule_revisions where game_id = %s", (gid,))
        assert cur.fetchone()[0] == 1

    # Kickoff moves two hours later; recorded as a revision known at T1.
    t1 = datetime(2023, 9, 1, 12, 0)
    h_moved = _handle("schedule")
    ingest_schedule(
        h_moved, connect, 2023, 2023,
        fetch=lambda s: _schedule_df(gametime="22:20"),
        revision_known_at=t1,
    )
    assert h_moved.rows_updated == 1

    with connect() as conn, conn.cursor() as cur:
        cur.execute("select kickoff_at from games where id = %s", (gid,))
        current_kickoff = cur.fetchone()[0]
        cur.execute("select count(*) from game_schedule_revisions where game_id = %s", (gid,))
        assert cur.fetchone()[0] == 2
        assert current_kickoff != original_kickoff  # Game reflects the new kickoff

        # As-of BEFORE the change: the original kickoff is what was known.
        cutoff_before = datetime(2023, 8, 15, 0, 0)
        cur.execute(
            "select kickoff_at from game_schedule_revisions "
            "where game_id = %s and known_at <= %s order by known_at desc limit 1",
            (gid, cutoff_before),
        )
        assert cur.fetchone()[0] == original_kickoff

        # As-of AFTER the change: the revised kickoff.
        cur.execute(
            "select kickoff_at from game_schedule_revisions "
            "where game_id = %s and known_at <= %s order by known_at desc limit 1",
            (gid, datetime(2023, 9, 2, 0, 0)),
        )
        assert cur.fetchone()[0] == current_kickoff


def test_schedule_unknown_team_raises(connect, clean_db) -> None:
    # No teams seeded → the KC/DET abbrs cannot resolve.
    with pytest.raises(ScheduleError):
        ingest_schedule(_handle("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())


def test_schema_drift_is_failure(connect, clean_db) -> None:
    bad = _teams_df().drop("team_conf")  # upstream renamed/dropped a required column
    with pytest.raises(SchemaDriftError):
        ingest_teams(_handle("teams"), connect, fetch=lambda: bad)
