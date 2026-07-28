"""Teams reference ingest. Idempotent upsert on the unique nflverse abbr."""

from __future__ import annotations

from collections.abc import Callable

import polars as pl

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import require_columns
from .nfl_sources import fetch_teams

_REQUIRED = ["team_abbr", "team_name", "team_conf", "team_division"]

_UPSERT = """
insert into teams (id, nflverse_abbr, full_name, conference, division, updated_at)
values (gen_random_uuid(), %(abbr)s, %(name)s, %(conf)s, %(div)s, now())
on conflict (nflverse_abbr) do update
   set full_name = excluded.full_name,
       conference = excluded.conference,
       division = excluded.division,
       updated_at = now()
   where teams.full_name is distinct from excluded.full_name
      or teams.conference is distinct from excluded.conference
      or teams.division is distinct from excluded.division
returning (xmax = 0) as inserted
"""


def ingest_teams(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch: Callable[[], pl.DataFrame] = fetch_teams,
    **_: object,
) -> None:
    df = fetch()
    require_columns(df, _REQUIRED, dataset="teams")

    written = updated = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for row in df.iter_rows(named=True):
                cur.execute(
                    _UPSERT,
                    {
                        "abbr": row["team_abbr"],
                        "name": row["team_name"],
                        "conf": row["team_conf"],
                        "div": row["team_division"],
                    },
                )
                result = cur.fetchone()
                if result is None:
                    continue  # unchanged row, WHERE guard skipped the update
                if result[0]:
                    written += 1
                else:
                    updated += 1
        conn.commit()

    handle.rows_written = written
    handle.rows_updated = updated


register(Dataset(name="teams", source="nflverse", run=ingest_teams))
