"""Thin wrappers around nflreadpy — the ONLY sanctioned nflverse client.

nfl_data_py is deprecated/archived; it is never imported. These fetchers are the
seam tests replace with fixtures, so the ingest logic is exercised without the
network.
"""

from __future__ import annotations

import polars as pl


def fetch_teams() -> pl.DataFrame:
    import nflreadpy as nfl

    return nfl.load_teams()


def fetch_players() -> pl.DataFrame:
    import nflreadpy as nfl

    return nfl.load_players()


def fetch_schedules(seasons: list[int]) -> pl.DataFrame:
    import nflreadpy as nfl

    return nfl.load_schedules(seasons=seasons)
