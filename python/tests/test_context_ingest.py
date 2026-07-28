"""Context ingest: snaps, injuries, and practice status as a bitemporal
observation stream. Requires a database."""

from __future__ import annotations

from datetime import datetime

import polars as pl
import pytest

from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.context import ingest_context
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db

NFL_GAME = "2023_01_DET_KC"
GSIS = "00-0033873"
PFR = "MahoPa00"


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["Kansas City", "Detroit"],
        "team_conf": ["AFC", "NFC"], "team_division": ["AFC West", "NFC North"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [GSIS], "display_name": ["Patrick Mahomes"], "position": ["QB"],
        "birth_date": ["1995-09-17"], "pfr_id": [PFR],
    })


def _schedule_df() -> pl.DataFrame:
    return pl.DataFrame({
        "game_id": [NFL_GAME], "season": [2023], "week": [1], "game_type": ["REG"],
        "gameday": ["2023-09-07"], "gametime": ["20:20"], "home_team": ["KC"],
        "away_team": ["DET"], "roof": ["outdoors"], "stadium": ["Arrowhead"], "result": [3],
    })


def _snaps_df(rows: int = 1) -> pl.DataFrame:
    if rows == 0:
        return pl.DataFrame({c: [] for c in [
            "game_id", "season", "pfr_player_id", "team",
            "offense_snaps", "offense_pct", "defense_snaps", "defense_pct", "st_pct",
        ]}, schema_overrides={"season": pl.Int64})
    return pl.DataFrame({
        "game_id": [NFL_GAME], "season": [2023], "pfr_player_id": [PFR], "team": ["KC"],
        "offense_snaps": [70.0], "offense_pct": [1.0],
        "defense_snaps": [0.0], "defense_pct": [0.0], "st_pct": [0.0],
    })


def _inj_df(report: str, practice: str, modified: datetime) -> pl.DataFrame:
    return pl.DataFrame({
        "season": [2023], "week": [1], "team": ["KC"], "gsis_id": [GSIS],
        "report_status": [report], "practice_status": [practice], "date_modified": [modified],
    })


def _empty_inj(season: int = 2023) -> pl.DataFrame:
    return pl.DataFrame(
        {"season": [], "week": [], "team": [], "gsis_id": [],
         "report_status": [], "practice_status": [], "date_modified": []},
        schema_overrides={"season": pl.Int64, "week": pl.Int64,
                          "date_modified": pl.Datetime},
    )


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    return connect


def test_snaps_and_injuries_store_with_correct_known_at(corpus) -> None:
    connect = corpus
    wed = datetime(2023, 9, 6, 20, 0)
    ingest_context(
        _h("context"), connect, 2023, 2023,
        fetch_snaps=lambda s: _snaps_df(),
        fetch_inj=lambda s: _inj_df("Questionable", "Limited Participation in Practice", wed),
        fetch_players_crosswalk=_players_df,
    )
    pid, gid = player_id(GSIS), game_id(NFL_GAME)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select kickoff_at from games where id = %s", (gid,))
        kickoff = cur.fetchone()[0]
        # Snap observations: reconstructed, known the day after (never game date).
        cur.execute(
            "select context_type, numeric_value, known_at, known_at_reconstructed "
            "from player_game_context where player_id=%s and context_type::text like 'snap%%' "
            "order by context_type",
            (pid,),
        )
        snaps = cur.fetchall()
        # Injury designation + practice status: observed known_at = date_modified.
        cur.execute(
            "select context_type, text_value, known_at, known_at_reconstructed "
            "from player_game_context where player_id=%s and numeric_value is null "
            "order by context_type",
            (pid,),
        )
        texts = cur.fetchall()

    types = {r[0] for r in snaps}
    assert {"snap_count_offense", "snap_pct_offense", "snap_pct_st"} <= types
    for _ctype, _val, known_at, reconstructed in snaps:
        assert reconstructed is True
        assert known_at > kickoff and known_at.date() != kickoff.date()

    text_by_type = {r[0]: (r[1], r[2], r[3]) for r in texts}
    assert text_by_type["injury_designation"][0] == "Questionable"
    assert text_by_type["injury_designation"][2] is False  # observed, not reconstructed
    assert text_by_type["injury_designation"][1] == wed    # known_at = date_modified
    assert text_by_type["practice_status"][0] == "Limited Participation in Practice"


def test_injury_progression_preserved_as_multiple_observations(corpus) -> None:
    connect = corpus
    wed, fri = datetime(2023, 9, 6, 20, 0), datetime(2023, 9, 8, 20, 0)

    # Wednesday snapshot, then Friday snapshot — an append-only stream.
    ingest_context(_h("context"), connect, 2023, 2023,
                   fetch_snaps=lambda s: _snaps_df(0),
                   fetch_inj=lambda s: _inj_df("Questionable", "Limited Participation in Practice", wed),
                   fetch_players_crosswalk=_players_df)
    ingest_context(_h("context"), connect, 2023, 2023,
                   fetch_snaps=lambda s: _snaps_df(0),
                   fetch_inj=lambda s: _inj_df("Out", "Did Not Participate In Practice", fri),
                   fetch_players_crosswalk=_players_df)

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select text_value, known_at from player_game_context "
            "where player_id=%s and context_type='injury_designation' order by known_at",
            (player_id(GSIS),),
        )
        rows = cur.fetchall()
    # Both observations retained, distinct knownAt — the Wed->Fri progression.
    assert [r[0] for r in rows] == ["Questionable", "Out"]
    assert rows[0][1] == wed and rows[1][1] == fri


def test_reingesting_same_snapshot_is_idempotent(corpus) -> None:
    connect = corpus
    wed = datetime(2023, 9, 6, 20, 0)
    args = dict(fetch_snaps=lambda s: _snaps_df(),
                fetch_inj=lambda s: _inj_df("Questionable", "Full Participation in Practice", wed),
                fetch_players_crosswalk=_players_df)
    ingest_context(_h("context"), connect, 2023, 2023, **args)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from player_game_context")
        first = cur.fetchone()[0]
    ingest_context(_h("context"), connect, 2023, 2023, **args)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from player_game_context")
        second = cur.fetchone()[0]
    assert first == second and first > 0


def test_missing_season_is_explicit_coverage_not_zero(corpus) -> None:
    connect = corpus
    wed = datetime(2023, 9, 6, 20, 0)
    # Ask for 2022-2023; injuries only has 2023 -> 2022 is an explicit gap.
    ingest_context(
        _h("context"), connect, 2022, 2023,
        fetch_snaps=lambda s: _snaps_df(),
        fetch_inj=lambda s: _inj_df("Out", "Did Not Participate In Practice", wed),
        fetch_players_crosswalk=_players_df,
    )
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select coverage, note from source_coverage "
            "where dataset='injuries' and season=2022"
        )
        coverage, note = cur.fetchone()
        cur.execute("select coverage from source_coverage where dataset='injuries' and season=2023")
        present = cur.fetchone()[0]
        # No back-filled/zeroed rows for the missing season.
        cur.execute("select count(*) from player_game_context where valid_at < '2023-01-01'")
        missing_rows = cur.fetchone()[0]
    assert coverage == "none" and note is not None
    assert present == "full"
    assert missing_rows == 0
