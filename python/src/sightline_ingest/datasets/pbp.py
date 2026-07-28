"""Play-by-play ingest.

One row per (game, play). knownAt reconstructs to the day after the game (never
the game date), knownAtReconstructed=true. Only a compact per-play payload is
stored as JSON — the full 370-column nflverse row is not warehoused here.
Idempotent: re-ingesting the same plays inserts nothing.
"""

from __future__ import annotations

from collections.abc import Callable

import polars as pl
from psycopg.types.json import Json

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import (
    day_after_game_knownat,
    game_id,
    require_columns,
    season_range,
    to_int,
)
from .nfl_sources import fetch_pbp

_KEY_COLS = ["game_id", "play_id", "qtr", "game_seconds_remaining", "posteam"]
# Compact per-play payload retained for later feature work (not all 370 columns).
_PAYLOAD_COLS = [
    "down", "ydstogo", "yardline_100", "play_type", "yards_gained",
    "pass", "rush", "touchdown", "passer_player_id", "rusher_player_id",
    "receiver_player_id", "epa", "wp",
]

_INSERT = """
insert into play_by_play (
    id, game_id, play_id, quarter, game_seconds_remaining, posteam_abbr,
    play_data, valid_at, known_at, known_at_reconstructed, source,
    ingest_run_id, created_at
) values (
    gen_random_uuid(), %(game_id)s, %(play_id)s, %(quarter)s,
    %(game_seconds_remaining)s, %(posteam_abbr)s, %(play_data)s,
    %(valid_at)s, %(known_at)s, true, 'nflverse', %(run_id)s, now()
)
on conflict (game_id, play_id) do nothing
"""


def ingest_pbp(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch: Callable[[list[int]], pl.DataFrame] = fetch_pbp,
    **_: object,
) -> None:
    seasons = season_range(season_from, season_to)
    df = fetch(seasons)
    require_columns(df, _KEY_COLS + _PAYLOAD_COLS, dataset="pbp")

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id, kickoff_at from games")
            kickoffs = {gid: kickoff for gid, kickoff in cur.fetchall()}

            rows: list[dict] = []
            present_games: set[str] = set()
            skipped = 0
            for r in df.iter_rows(named=True):
                gid = game_id(r["game_id"])
                kickoff = kickoffs.get(gid)
                if kickoff is None:
                    skipped += 1  # game not ingested / out of scope
                    continue
                present_games.add(gid)
                rows.append(
                    {
                        "game_id": gid,
                        "play_id": to_int(r["play_id"]),
                        "quarter": to_int(r["qtr"]),
                        "game_seconds_remaining": to_int(r["game_seconds_remaining"]),
                        "posteam_abbr": r["posteam"],
                        "play_data": Json({c: r[c] for c in _PAYLOAD_COLS}),
                        "valid_at": kickoff,
                        "known_at": day_after_game_knownat(kickoff),
                        "run_id": handle.run_id,
                    }
                )

            game_list = list(present_games)
            cur.execute(
                "select count(*) from play_by_play where game_id = any(%s)", (game_list,)
            )
            before = cur.fetchone()[0]
            if rows:
                cur.executemany(_INSERT, rows)
            cur.execute(
                "select count(*) from play_by_play where game_id = any(%s)", (game_list,)
            )
            after = cur.fetchone()[0]
        conn.commit()

    handle.rows_written = after - before
    if skipped:
        handle.mark_partial(f"{skipped} plays skipped (game not in corpus)")


register(Dataset(name="pbp", source="nflverse", run=ingest_pbp))
