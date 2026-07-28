"""Players reference ingest.

Player carries a stable cross-season, cross-team identity keyed off the nflverse
gsis id (deterministic uuid5). It deliberately holds NO current-team field —
``latest_team`` from nflverse is intentionally dropped, because joining current
roster state to a historical game leaks future trades. Team affiliation is
per-game context, recorded on the fact tables.
"""

from __future__ import annotations

from collections.abc import Callable

import polars as pl

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import parse_date, player_id, require_columns
from .nfl_sources import fetch_players

_REQUIRED = ["gsis_id", "display_name", "position", "birth_date"]

_UPSERT = """
insert into players (id, full_name, position, birth_date, updated_at)
values (%(id)s, %(name)s, %(position)s, %(birth_date)s, now())
on conflict (id) do update
   set full_name = excluded.full_name,
       position = excluded.position,
       birth_date = excluded.birth_date,
       updated_at = now()
   where players.full_name is distinct from excluded.full_name
      or players.position is distinct from excluded.position
      or players.birth_date is distinct from excluded.birth_date
returning (xmax = 0) as inserted
"""


def ingest_players(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch: Callable[[], pl.DataFrame] = fetch_players,
    **_: object,
) -> None:
    df = fetch()
    require_columns(df, _REQUIRED, dataset="players")

    written = updated = skipped = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for row in df.iter_rows(named=True):
                gsis = row["gsis_id"]
                if not gsis:
                    # No stable identity anchor; retained upstream, not invented here.
                    skipped += 1
                    continue
                cur.execute(
                    _UPSERT,
                    {
                        "id": player_id(gsis),
                        "name": row["display_name"],
                        "position": row["position"],
                        "birth_date": parse_date(row["birth_date"]),
                    },
                )
                result = cur.fetchone()
                if result is None:
                    continue
                if result[0]:
                    written += 1
                else:
                    updated += 1
        conn.commit()

    handle.rows_written = written
    handle.rows_updated = updated
    if skipped:
        handle.mark_partial(f"{skipped} players skipped (no gsis_id)")


register(Dataset(name="players", source="nflverse", run=ingest_players))
