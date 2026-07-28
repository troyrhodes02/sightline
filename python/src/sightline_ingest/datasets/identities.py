"""Cross-source player identity ingest.

Two modes:

  * ``sightline-ingest identities`` — populate resolved nflverse and ESPN
    external ids from the nflverse players crosswalk (each player row carries
    both gsis_id and espn_id, so these resolve confidently 1:1).

  * ``sightline-ingest identities --source kalshi --from-samples FILE`` — resolve
    a static Kalshi naming sample against the canonical Player set by name.
    Confident matches resolve; collisions are retained as ``ambiguous`` with the
    candidate set; misses are ``unresolved``. Nothing is dropped or guessed.

A manual override is never overwritten by a later automatic pass.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import polars as pl
from psycopg.types.json import Json

from ..db import ConnectionFactory
from ..errors import IngestError
from ..identity_resolution import (
    AMBIGUOUS,
    RESOLVED,
    NameIndex,
    Resolution,
)
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import player_id, require_columns
from .nfl_sources import fetch_players

_REQUIRED_PLAYER_COLS = ["gsis_id", "display_name", "espn_id"]

_UPSERT = """
insert into player_external_ids
    (id, source, external_id, external_name, player_id, status, candidate_ids,
     created_at, updated_at)
values
    (gen_random_uuid(), %(source)s, %(external_id)s, %(external_name)s,
     %(player_id)s, %(status)s, %(candidate_ids)s, now(), now())
on conflict (source, external_id, external_name) do update
   set player_id = excluded.player_id,
       status = excluded.status,
       candidate_ids = excluded.candidate_ids,
       updated_at = now()
   where player_external_ids.status <> 'manual_override'
     and (player_external_ids.player_id is distinct from excluded.player_id
          or player_external_ids.status is distinct from excluded.status
          or player_external_ids.candidate_ids is distinct from excluded.candidate_ids)
returning (xmax = 0) as inserted
"""


class IdentitiesError(IngestError):
    pass


def _upsert(cur, *, source: str, external_id: str, external_name: str,
            resolution: Resolution) -> int | None:
    """Upsert one external id. Returns True (inserted), False (updated), None (no-op)."""
    cur.execute(
        _UPSERT,
        {
            "source": source,
            "external_id": external_id,
            "external_name": external_name,
            "player_id": resolution.player_id,
            "status": resolution.status,
            "candidate_ids": Json(resolution.candidate_ids)
            if resolution.candidate_ids
            else None,
        },
    )
    result = cur.fetchone()
    return None if result is None else result[0]


def _tally(handle: IngestRunHandle, outcome: int | None) -> None:
    if outcome is True:
        handle.rows_written += 1
    elif outcome is False:
        handle.rows_updated += 1


def _populate_from_players(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    fetch: Callable[[], pl.DataFrame],
    sources: set[str],
) -> None:
    df = fetch()
    require_columns(df, _REQUIRED_PLAYER_COLS, dataset="identities")

    with connect() as conn:
        with conn.cursor() as cur:
            for row in df.iter_rows(named=True):
                gsis = row["gsis_id"]
                if not gsis:
                    continue
                pid = player_id(gsis)
                name = row["display_name"]
                resolved = Resolution(RESOLVED, player_id=pid)

                if "nflverse" in sources:
                    _tally(handle, _upsert(
                        cur, source="nflverse", external_id=gsis,
                        external_name=name, resolution=resolved,
                    ))
                if "espn" in sources and row["espn_id"]:
                    _tally(handle, _upsert(
                        cur, source="espn", external_id=str(row["espn_id"]),
                        external_name=name, resolution=resolved,
                    ))
        conn.commit()


def _load_samples(path: str) -> list[dict]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("players", [])
    entries: list[dict] = []
    for item in raw:
        if isinstance(item, str):
            entries.append({"name": item, "id": item})
        elif isinstance(item, dict) and item.get("name"):
            entries.append({"name": item["name"], "id": item.get("id") or item.get("ticker") or item["name"]})
        else:
            raise IdentitiesError(f"invalid Kalshi sample entry: {item!r}")
    return entries


def _players_index(cur) -> NameIndex:
    cur.execute("select id, full_name from players")
    return NameIndex.from_players([(pid, name) for pid, name in cur.fetchall()])


def _resolve_kalshi(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    from_samples: str,
    source: str,
) -> None:
    entries = _load_samples(from_samples)
    resolved = ambiguous = unresolved = 0

    with connect() as conn:
        with conn.cursor() as cur:
            index = _players_index(cur)
            for entry in entries:
                resolution = index.resolve(entry["name"])
                if resolution.status == RESOLVED:
                    resolved += 1
                elif resolution.status == AMBIGUOUS:
                    ambiguous += 1
                else:
                    unresolved += 1
                _tally(handle, _upsert(
                    cur, source=source, external_id=str(entry["id"]),
                    external_name=entry["name"], resolution=resolution,
                ))
        conn.commit()

    # Ambiguous/unresolved are a normal, surfaced outcome — not a failure — but
    # they are recorded so the operator can act on the override path.
    if ambiguous or unresolved:
        handle.mark_partial(
            f"kalshi identities: {resolved} resolved, {ambiguous} ambiguous, "
            f"{unresolved} unresolved (retained for manual override)"
        )


def ingest_identities(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    source: str | None = None,
    from_samples: str | None = None,
    fetch: Callable[[], pl.DataFrame] = fetch_players,
    **_: object,
) -> None:
    if from_samples:
        _resolve_kalshi(handle, connect, from_samples, source=source or "kalshi")
        return
    if source == "kalshi":
        raise IdentitiesError("--source kalshi requires --from-samples FILE")
    sources = {source} if source in {"nflverse", "espn"} else {"nflverse", "espn"}
    _populate_from_players(handle, connect, fetch, sources)


register(Dataset(name="identities", source="nflverse", run=ingest_identities))
