"""Final player box-score ingest with versioned stat corrections.

One current row per (player, game) — the grading target — with typed Decimal
columns (never Float). knownAt reconstructs to the day after the game.
``teamAbbrAtGame`` records the team the player was on THAT game (per-game
context, not current roster).

Corrections: a genuine change in an already-stored player-game bumps
``version``, appends a ``PlayerGameStatCorrection`` preserving the prior value
and the correction's availability, and updates the current row. Re-ingesting an
identical line is an idempotent no-op.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal

import polars as pl
from psycopg.types.json import Json

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import (
    day_after_game_knownat,
    game_id,
    player_id,
    require_columns,
    season_range,
    to_decimal,
    to_int,
)
from .nfl_sources import fetch_player_stats

# (db column, nflverse column, kind). Order is the canonical column order.
STAT_COLUMNS: list[tuple[str, str, str]] = [
    ("passing_yards", "passing_yards", "decimal"),
    ("passing_tds", "passing_tds", "int"),
    ("passing_attempts", "attempts", "int"),
    ("completions", "completions", "int"),
    ("interceptions", "passing_interceptions", "int"),
    ("rushing_yards", "rushing_yards", "decimal"),
    ("rushing_tds", "rushing_tds", "int"),
    ("carries", "carries", "int"),
    ("receiving_yards", "receiving_yards", "decimal"),
    ("receiving_tds", "receiving_tds", "int"),
    ("receptions", "receptions", "int"),
    ("targets", "targets", "int"),
]
_DB_COLS = [c[0] for c in STAT_COLUMNS]
_REQUIRED = ["player_id", "game_id", "team", *[c[1] for c in STAT_COLUMNS]]

_INSERT = f"""
insert into player_game_stats (
    id, player_id, game_id, team_abbr_at_game,
    {", ".join(_DB_COLS)},
    version, valid_at, known_at, known_at_reconstructed, source,
    ingest_run_id, created_at, updated_at
) values (
    gen_random_uuid(), %(player_id)s, %(game_id)s, %(team)s,
    {", ".join(f"%({c})s" for c in _DB_COLS)},
    1, %(valid_at)s, %(known_at)s, true, 'nflverse', %(run_id)s, now(), now()
)
"""

_UPDATE = f"""
update player_game_stats
   set {", ".join(f"{c} = %({c})s" for c in _DB_COLS)},
       version = %(version)s, known_at = %(known_at)s, updated_at = now()
 where id = %(id)s
"""

_INSERT_CORRECTION = """
insert into player_game_stat_corrections (
    id, player_game_stat_id, version, prior_values, corrected_values,
    correction_known_at, source, ingest_run_id, created_at
) values (
    gen_random_uuid(), %(stat_id)s, %(version)s, %(prior)s, %(corrected)s,
    %(correction_known_at)s, 'nflverse', %(run_id)s, now()
)
"""


def _stat_values(row: dict) -> dict[str, object]:
    out: dict[str, object] = {}
    for db_col, src_col, kind in STAT_COLUMNS:
        out[db_col] = to_decimal(row[src_col]) if kind == "decimal" else to_int(row[src_col])
    return out


def _jsonable(values: dict[str, object]) -> dict[str, object]:
    return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in values.items()}


def ingest_stats(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch: Callable[[list[int]], pl.DataFrame] = fetch_player_stats,
    correction_known_at: datetime | None = None,
    **_: object,
) -> None:
    seasons = season_range(season_from, season_to)
    df = fetch(seasons)
    require_columns(df, _REQUIRED, dataset="stats")

    corr_known = correction_known_at or datetime.now(timezone.utc).replace(
        tzinfo=None, microsecond=0
    )

    written = corrected = skipped = 0
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id, kickoff_at from games")
            kickoffs = {gid: k for gid, k in cur.fetchall()}
            cur.execute("select id from players")
            known_players = {pid for (pid,) in cur.fetchall()}

            for row in df.iter_rows(named=True):
                gsis = row["player_id"]
                if not gsis:
                    skipped += 1
                    continue
                pid = player_id(gsis)
                gid = game_id(row["game_id"])
                kickoff = kickoffs.get(gid)
                if kickoff is None or pid not in known_players:
                    skipped += 1  # player/game not in corpus; surfaced, not invented
                    continue

                values = _stat_values(row)
                cur.execute(
                    f"select id, version, {', '.join(_DB_COLS)} "
                    "from player_game_stats where player_id = %s and game_id = %s",
                    (pid, gid),
                )
                existing = cur.fetchone()

                if existing is None:
                    cur.execute(
                        _INSERT,
                        {
                            "player_id": pid, "game_id": gid, "team": row["team"],
                            "valid_at": kickoff, "known_at": day_after_game_knownat(kickoff),
                            "run_id": handle.run_id, **values,
                        },
                    )
                    written += 1
                    continue

                stat_id, version = existing[0], existing[1]
                stored = dict(zip(_DB_COLS, existing[2:]))
                if stored == values:
                    continue  # idempotent no-op

                # Genuine correction: version the change and preserve the prior line.
                new_version = version + 1
                cur.execute(
                    _INSERT_CORRECTION,
                    {
                        "stat_id": stat_id, "version": new_version,
                        "prior": Json(_jsonable(stored)),
                        "corrected": Json(_jsonable(values)),
                        "correction_known_at": corr_known, "run_id": handle.run_id,
                    },
                )
                cur.execute(
                    _UPDATE,
                    {"id": stat_id, "version": new_version, "known_at": corr_known, **values},
                )
                corrected += 1

        conn.commit()

    handle.rows_written = written
    handle.rows_updated = corrected
    if skipped:
        handle.mark_partial(f"{skipped} stat rows skipped (player/game not in corpus)")


register(Dataset(name="stats", source="nflverse", run=ingest_stats))
