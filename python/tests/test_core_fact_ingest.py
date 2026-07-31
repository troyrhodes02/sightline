"""Core fact ingest: play-by-play and player stats with versioned corrections.

Uses injected Polars fixtures (no network). Requires a database.
"""

from __future__ import annotations

from datetime import datetime

import polars as pl
import pytest

from sightline_ingest.datasets._common import day_after_game_knownat, game_id, player_id
from sightline_ingest.datasets.pbp import ingest_pbp
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db

NFL_GAME = "2023_01_DET_KC"
GSIS = "00-0033873"  # Patrick Mahomes
GSIS_WR = "00-0000001"  # a receiver, for the null-vs-zero derivation tests
GSIS_RB = "00-0000002"  # a running back, for the role-plausibility clause


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
            "stadium": ["Arrowhead"], "location": ["Home"], "result": [3],
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
    # 09:00 ET the morning after the game's EASTERN date (Thu 8:20pm ET game
    # -> Friday 09:00 ET = 13:00 UTC), matching the documented rule exactly.
    assert known_at == day_after_game_knownat(kickoff)
    assert known_at == datetime(2023, 9, 8, 13, 0)

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


# --- SIG-25: null-vs-zero, dedup, and pre-2002 skip ------------------------


def _players_with_wr_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "gsis_id": [GSIS, GSIS_WR, GSIS_RB],
            "display_name": ["Patrick Mahomes", "A Receiver", "A Back"],
            "position": ["QB", "WR", "RB"],
            "birth_date": ["1995-09-17", "2000-01-01", "1998-01-01"],
        }
    )


def _rb_and_qb_carries_no_target_df() -> pl.DataFrame:
    """A back and a quarterback each with carries and ZERO targets.

    The back played (carried) and was not targeted — a genuine 0-target
    receiving game the role clause must KEEP. The quarterback's 0 targets is
    absence, and the role gate must keep it NULL rather than flipping him into
    the receiving universe.
    """
    return pl.DataFrame(
        {
            "player_id": [GSIS_RB, GSIS],
            "game_id": [NFL_GAME, NFL_GAME],
            "team": ["KC", "KC"],
            "passing_yards": [0.0, 305.0], "passing_tds": [0, 2], "attempts": [0, 39],
            "completions": [0, 26], "passing_interceptions": [0, 0],
            "rushing_yards": [72.0, 18.0], "rushing_tds": [1, 0], "carries": [15, 3],
            "receiving_yards": [0.0, 0.0], "receiving_tds": [0, 0],
            "receptions": [0, 0], "targets": [0, 0],
        }
    )


def _zero_filled_stats_df() -> pl.DataFrame:
    """nflverse-style: non-participation reported as 0, not null.

    The QB has 0 targets/carries in receiving; the WR was targeted six times but
    caught nothing (a genuine zero) and threw no passes / took no carries.
    """
    return pl.DataFrame(
        {
            "player_id": [GSIS, GSIS_WR],
            "game_id": [NFL_GAME, NFL_GAME],
            "team": ["KC", "KC"],
            "passing_yards": [305.0, 0.0], "passing_tds": [2, 0], "attempts": [39, 0],
            "completions": [26, 0], "passing_interceptions": [0, 0],
            "rushing_yards": [45.0, 0.0], "rushing_tds": [0, 0], "carries": [4, 0],
            "receiving_yards": [0.0, 0.0], "receiving_tds": [0, 0],
            "receptions": [0, 0], "targets": [0, 6],
        }
    )


def test_non_participation_is_null_and_a_targeted_zero_is_zero(corpus) -> None:
    connect = corpus
    ingest_players(_h("players"), connect, fetch=_players_with_wr_df)
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _zero_filled_stats_df())

    with connect() as conn, conn.cursor() as cur:
        # QB: no targets -> receiving columns are absence (NULL), never a zero.
        cur.execute(
            "select receiving_yards, receptions, targets, passing_yards, carries "
            "from player_game_stats where player_id = %s and game_id = %s",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        rec_yds, receptions, targets, pass_yds, carries = cur.fetchone()
        assert rec_yds is None
        assert receptions is None
        assert targets is None
        assert float(pass_yds) == 305.0  # participated in passing
        assert carries == 4              # participated in rushing

        # WR: six targets, zero receiving yards -> a genuine zero, preserved;
        # no attempts / carries -> passing and rushing are absence.
        cur.execute(
            "select receiving_yards, targets, passing_yards, rushing_yards "
            "from player_game_stats where player_id = %s and game_id = %s",
            (player_id(GSIS_WR), game_id(NFL_GAME)),
        )
        wr_rec_yds, wr_targets, wr_pass, wr_rush = cur.fetchone()
        assert float(wr_rec_yds) == 0.0
        assert wr_targets == 6
        assert wr_pass is None
        assert wr_rush is None


def test_role_clause_keeps_a_backs_zero_target_game_but_not_a_qbs(corpus) -> None:
    connect = corpus
    ingest_players(_h("players"), connect, fetch=_players_with_wr_df)
    ingest_stats(
        _h("stats"), connect, 2023, 2023,
        fetch=lambda s: _rb_and_qb_carries_no_target_df(),
    )

    with connect() as conn, conn.cursor() as cur:
        # RB: carried, drew no target -> a GENUINE 0-target receiving game (kept),
        # not absence. This is the population the plain targets>0 rule erased.
        cur.execute(
            "select receiving_yards, receptions, targets from player_game_stats "
            "where player_id = %s and game_id = %s",
            (player_id(GSIS_RB), game_id(NFL_GAME)),
        )
        rb_rec_yds, rb_rec, rb_targets = cur.fetchone()
        assert float(rb_rec_yds) == 0.0
        assert rb_rec == 0
        assert rb_targets == 0

        # QB: also carried with no target, but the role gate must NOT flip a
        # quarterback into the receiving universe — that is the SIG-25 defect.
        cur.execute(
            "select receiving_yards, targets from player_game_stats "
            "where player_id = %s and game_id = %s",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        qb_rec_yds, qb_targets = cur.fetchone()
        assert qb_rec_yds is None
        assert qb_targets is None


def test_duplicate_player_game_in_one_batch_is_collapsed_last_wins(corpus) -> None:
    connect = corpus
    # Same (player, game) twice in one fetch frame — previously a unique-key
    # violation; now collapsed last-wins with no error.
    df = pl.concat([_stats_df(305.0), _stats_df(311.0)])
    h = _h("stats")
    ingest_stats(h, connect, 2023, 2023, fetch=lambda s: df)
    assert h.rows_written == 1

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select count(*), passing_yards from player_game_stats "
            "where player_id = %s and game_id = %s group by passing_yards",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        count, pass_yds = cur.fetchone()
    assert count == 1
    assert float(pass_yds) == 311.0  # the last occurrence won


def test_row_with_missing_team_is_skipped_not_a_constraint_violation(corpus) -> None:
    connect = corpus
    # Pre-2002 rows carry no team_abbr_at_game. Skip and count, never trip the
    # NOT NULL constraint mid-load.
    df = _stats_df(305.0).with_columns(pl.lit(None, dtype=pl.Utf8).alias("team"))
    h = _h("stats")
    ingest_stats(h, connect, 2023, 2023, fetch=lambda s: df)
    assert h.rows_written == 0

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select count(*) from player_game_stats "
            "where player_id = %s and game_id = %s",
            (player_id(GSIS), game_id(NFL_GAME)),
        )
        assert cur.fetchone()[0] == 0
