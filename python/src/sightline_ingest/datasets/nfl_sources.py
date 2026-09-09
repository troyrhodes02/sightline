"""Thin wrappers around nflreadpy — the ONLY sanctioned nflverse client.

nfl_data_py is deprecated/archived; it is never imported. These fetchers are the
seam tests replace with fixtures, so the ingest logic is exercised without the
network.

Early-season availability note: nflreadpy's get_current_season() uses the Thursday
following Labor Day as the season-start boundary. For the 2–3 days between Labor Day
and that Thursday (e.g. Sep 7–9, 2026), requests for the current calendar-year
season raise ValueError even though the season is real and imminent. Upstream data
files also won't exist until games are played. Both cases return empty DataFrames with
the required column schema so the ingest records 0 rows rather than failing — 0 rows
is the correct result when no games have been played yet.
"""

from __future__ import annotations

import sys
from datetime import date

import polars as pl

# Required column schemas for empty DataFrames returned during early-season periods
# when nflreadpy rejects the season or upstream files don't exist yet.
_PBP_COLS = [
    "game_id", "play_id", "qtr", "game_seconds_remaining", "posteam",
    "down", "ydstogo", "yardline_100", "play_type", "yards_gained",
    "pass", "rush", "touchdown", "passer_player_id", "rusher_player_id",
    "receiver_player_id", "epa", "wp",
]
_STATS_COLS = [
    "player_id", "game_id", "team", "passing_yards", "passing_tds",
    "attempts", "completions", "passing_interceptions", "rushing_yards",
    "rushing_tds", "carries", "receiving_yards", "receiving_tds",
    "receptions", "targets",
]
_SNAP_COLS = [
    "game_id", "season", "pfr_player_id", "team",
    "offense_snaps", "offense_pct", "defense_snaps", "defense_pct", "st_pct",
]
_INJURY_COLS = [
    "season", "week", "team", "gsis_id", "report_status", "practice_status", "date_modified",
]


def _is_early_season_error(exc: Exception, seasons: list[int]) -> bool:
    """True when nflreadpy rejects a season that is within the current calendar year,
    or when the upstream file doesn't exist yet (404 on first week of a new season)."""
    msg = str(exc)
    current_year = date.today().year
    if not all(s <= current_year for s in seasons):
        return False
    return "Season must be between" in msg or "404" in msg or "404 Client Error" in msg


def _empty(cols: list[str]) -> pl.DataFrame:
    return pl.DataFrame({c: pl.Series(c, [], dtype=pl.Utf8) for c in cols})


def fetch_teams() -> pl.DataFrame:
    import nflreadpy as nfl

    return nfl.load_teams()


def fetch_players() -> pl.DataFrame:
    import nflreadpy as nfl

    return nfl.load_players()


def fetch_schedules(seasons: list[int]) -> pl.DataFrame:
    import nflreadpy as nfl

    return nfl.load_schedules(seasons=seasons)


def fetch_pbp(seasons: list[int]) -> pl.DataFrame:
    import nflreadpy as nfl

    try:
        return nfl.load_pbp(seasons=seasons)
    except Exception as exc:  # noqa: BLE001
        if _is_early_season_error(exc, seasons):
            print(
                f"nfl_sources: pbp not yet available for seasons {seasons} "
                f"({exc}); returning empty frame",
                file=sys.stderr,
            )
            return _empty(_PBP_COLS)
        raise


def fetch_player_stats(seasons: list[int]) -> pl.DataFrame:
    import nflreadpy as nfl

    try:
        return nfl.load_player_stats(seasons=seasons)
    except Exception as exc:  # noqa: BLE001
        if _is_early_season_error(exc, seasons):
            print(
                f"nfl_sources: player_stats not yet available for seasons {seasons} "
                f"({exc}); returning empty frame",
                file=sys.stderr,
            )
            return _empty(_STATS_COLS)
        raise


def fetch_snap_counts(seasons: list[int]) -> pl.DataFrame:
    import nflreadpy as nfl

    try:
        return nfl.load_snap_counts(seasons=seasons)
    except Exception as exc:  # noqa: BLE001
        if _is_early_season_error(exc, seasons):
            print(
                f"nfl_sources: snap_counts not yet available for seasons {seasons} "
                f"({exc}); returning empty frame",
                file=sys.stderr,
            )
            return _empty(_SNAP_COLS)
        raise


def fetch_injuries(seasons: list[int]) -> pl.DataFrame:
    import nflreadpy as nfl

    try:
        return nfl.load_injuries(seasons=seasons)
    except Exception as exc:  # noqa: BLE001
        if _is_early_season_error(exc, seasons):
            print(
                f"nfl_sources: injuries not yet available for seasons {seasons} "
                f"({exc}); returning empty frame",
                file=sys.stderr,
            )
            return _empty(_INJURY_COLS)
        raise
