"""Shared helpers for dataset ingest: deterministic ids, schema checks, and the
per-source ``knownAt`` reconstruction used by reference ingest.

Deterministic ids (uuid5 from the nflverse natural key) make re-ingest an upsert
without needing the identity-resolution table: the same nflverse player/game
always maps to the same Sightline id, so a mid-season trade keeps one stable
``Player`` and re-running changes nothing.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import polars as pl

from ..errors import SchemaDriftError

# Fixed namespace so ids are stable across machines and runs.
_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # RFC 4122 URL namespace

_ET = ZoneInfo("America/New_York")
_UTC = ZoneInfo("UTC")


def player_id(gsis_id: str) -> str:
    """Stable Sightline Player id for an nflverse gsis id."""
    return str(uuid.uuid5(_NS, f"nflverse:player:{gsis_id}"))


def game_id(nflverse_game_id: str) -> str:
    """Stable Sightline Game id for an nflverse game id (e.g. '2023_01_DET_KC')."""
    return str(uuid.uuid5(_NS, f"nflverse:game:{nflverse_game_id}"))


def require_columns(df: pl.DataFrame, columns: list[str], *, dataset: str) -> None:
    """Raise SchemaDriftError if a required column is missing.

    A technically successful fetch that is structurally incomplete (a renamed or
    dropped upstream column) is a failure, not a partial success.
    """
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise SchemaDriftError(
            f"{dataset}: upstream schema drift — missing column(s): {missing}"
        )


def season_type(game_type: str) -> str:
    """Map an nflverse game_type to REG / POST / PRE."""
    if game_type == "REG":
        return "REG"
    if game_type == "PRE":
        return "PRE"
    return "POST"  # WC / DIV / CON / SB and any other postseason label


def parse_kickoff(gameday: str | None, gametime: str | None) -> datetime | None:
    """Combine nflverse gameday + gametime (US Eastern) into a naive-UTC datetime.

    Returns None when the day is unknown (unscheduled future game). The DB column
    is ``timestamp(3)`` (no tz), so we store the naive UTC wall time.
    """
    if not gameday:
        return None
    time = gametime if gametime else "00:00"
    local = datetime.strptime(f"{gameday} {time}", "%Y-%m-%d %H:%M").replace(tzinfo=_ET)
    return local.astimezone(_UTC).replace(tzinfo=None)


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def schedule_release_knownat(season: int) -> datetime:
    """Reconstructed availability of a season's schedule.

    The full schedule is public months before Week 1; resolving to Aug 1 of the
    season is a conservative *later* bound (never earlier than the true release,
    never the game date). Reconstructed — callers set knownAtReconstructed=true.
    """
    return datetime(season, 8, 1, 12, 0)
