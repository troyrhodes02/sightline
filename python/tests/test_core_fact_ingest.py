"""Core fact ingest: play-by-play and player stats with versioned corrections.

Uses injected Polars fixtures (no network). Requires a database.
"""

from __future__ import annotations

from datetime import datetime

import polars as pl
import pytest

from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.pbp import ingest_pbp
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db

NFL_GAME = "2023_01_DET_KC"
GSIS = "00-0033873"  # Patrick Mahomes


def _h(dataset: str) -> IngestRunHandle:
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
            "gsis_id": [GSIS],
            "display_name": ["Patrick Mahomes"],
            "position": ["QB"],
            "birth_date": ["1995-09-17"],
        }
    )


def _schedule_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "game_id": [NFL_GAME], "season": [2023], "week": [1], "game_type": ["REG"],
            "gameday": ["2023-09-07"], "gametime": ["20:20"], "home_team": ["KC"],
            "away_team": ["DET"], "roof": ["outdoors"],
            "stadium": ["Arrowhead"], "result": [3],
        }
    )


def _pbp_df() -> pl.DataFrame:
    base = {
        "game_id": [NFL_GAME, NFL_GAME], "play_id": [1, 39], "qtr": [1, 1],
        "game_seconds_remaining": [3600, 3555], "posteam": ["KC", "KC"],
        "down": [None, 1], "ydstogo": [0, 10], "yardline_100": [None, 75],
        "play_type": ["kickoff", "pass"], "yards_gained": [0, 12],
        "pass": [0, 1], "rush": [0, 0], "touchdown": [0, 0],
        "passer_player_id": [None, GSIS], "rusher_player_id": [None, None],
        "receiver_player_id": [None, "00-0000001"], "epa": [0.1, 0.8], "wp": [0.5, 0.55],
    }
    return pl.DataFrame(base)


def _stats_df(passing_yards: float) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "player_id": [GSIS], "game_id": [NFL_GAME], "team": ["KC"],
            "passing_yards": [passing_yards], "passing_tds": [2], "attempts": [39],
            "completions": [26], "passing_interceptions": [0],
            "rushing_yards": [45.0], "rushing_tds": [0], "carries": [4],
            "receiving_yards": [None], "receiving_tds": [None],
            "receptions": [None], "targets": [None],
        }
    )


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    return connect


# --- Play-by-play ----------------------------------------------------------

def test_pbp_ingest_reconstructs_known_at_and_is_idempotent(corpus) -> None:
    connect = corpus
    h = _h("pbp")
    ingest_pbp(h, connect, 2023, 2023, fetch=lambda s: _pbp_df())
    assert h.rows_written == 2

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select valid_at, known_at, known_at_reconstructed "
            "from play_by_play where game_id = %s order by play_id",
            (game_id(NFL_GAME),),
        )
        valid_at, known_at, reconstructed = cur.fetchone()
        cur.execute("select kickoff_at from games where id = %s", (game_id(NFL_GAME),))
        kickoff = cur.fetchone()[0]

    assert valid_at == kickoff
    assert reconstructed is True
    assert known_at > kickoff                      # known after the play was true
    assert known_at.date() != kickoff.date()       # never the game date

    # Idempotent re-ingest.
    h2 = _h("pbp")
    ingest_pbp(h2, connect, 2023, 2023, fetch=lambda s: _pbp_df())
    assert h2.rows_written == 0
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from play_by_play where game_id = %s", (game_id(NFL_GAME),))
        assert cur.fetchone()[0] == 2


# --- Player stats + corrections -------------------------------------------

def test_stats_ingest_records_line_and_is_idempotent(corpus) -> None:
    connect = corpus
    h = _h("stats")
    ingest_stats(h, connect, 2023, 2023, fetch=lambda s: _stats_df(305.0))
    assert h.rows_written == 1

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select team_abbr_at_game, passing_yards, version, known_at, "
            "known_at_reconstructed from player_game_stats "
            "where player_id = %s and game_id = %s",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        team, pass_yds, version, known_at, reconstructed = cur.fetchone()
    assert team == "KC"
    assert float(pass_yds) == 305.0
    assert version == 1
    assert reconstructed is True

    # Idempotent: identical re-ingest makes no change and no correction.
    h2 = _h("stats")
    ingest_stats(h2, connect, 2023, 2023, fetch=lambda s: _stats_df(305.0))
    assert (h2.rows_written, h2.rows_updated) == (0, 0)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from player_game_stat_corrections")
        assert cur.fetchone()[0] == 0


def test_stat_correction_versions_and_preserves_prior_value(corpus) -> None:
    connect = corpus
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df(305.0))

    # Three days later an upstream correction lands: 305 -> 320.
    t_corr = datetime(2023, 9, 12, 15, 0)
    h = _h("stats")
    ingest_stats(
        h, connect, 2023, 2023,
        fetch=lambda s: _stats_df(320.0), correction_known_at=t_corr,
    )
    assert h.rows_updated == 1

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select passing_yards, version, known_at from player_game_stats "
            "where player_id = %s and game_id = %s",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        pass_yds, version, known_at = cur.fetchone()
        cur.execute(
            "select version, prior_values, corrected_values, correction_known_at "
            "from player_game_stat_corrections "
            "where player_game_stat_id = (select id from player_game_stats "
            "where player_id = %s and game_id = %s)",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        c_version, prior, corrected, c_known = cur.fetchone()

    # Current row holds the corrected value at version 2, known at correction time.
    assert float(pass_yds) == 320.0
    assert version == 2
    assert known_at == t_corr
    # "As published on game day" (305) is answerable via the correction log.
    assert c_version == 2
    assert prior["passing_yards"] == 305.0
    assert corrected["passing_yards"] == 320.0
    assert c_known == t_corr

    # Re-running the same correction is an idempotent no-op.
    h2 = _h("stats")
    ingest_stats(
        h2, connect, 2023, 2023,
        fetch=lambda s: _stats_df(320.0), correction_known_at=t_corr,
    )
    assert (h2.rows_written, h2.rows_updated) == (0, 0)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from player_game_stat_corrections")
        assert cur.fetchone()[0] == 1
