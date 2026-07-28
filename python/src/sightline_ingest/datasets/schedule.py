"""Schedule reference ingest with bitemporal schedule-change handling.

A schedule change (kickoff moved, venue changed, status changed) updates the
Game's current fields AND appends a ``GameScheduleRevision`` carrying its own
``knownAt`` — never a plain field mutation. That way an as-of read before the
change still sees the kickoff/venue that was known at the earlier cutoff.

Idempotence falls out of this: re-ingesting an unchanged schedule detects no
change and appends nothing.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

import polars as pl

from ..db import ConnectionFactory
from ..errors import IngestError
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import (
    game_id,
    parse_kickoff,
    require_columns,
    schedule_release_knownat,
    season_type,
)
from .nfl_sources import fetch_schedules

_REQUIRED = [
    "game_id", "season", "week", "game_type", "gameday", "gametime",
    "home_team", "away_team", "roof", "stadium", "result",
]

_INSERT_GAME = """
insert into games (
    id, season, week, season_type, home_team_id, away_team_id,
    venue, is_dome, status, kickoff_at, updated_at
) values (
    %(id)s, %(season)s, %(week)s, %(season_type)s, %(home)s, %(away)s,
    %(venue)s, %(is_dome)s, %(status)s, %(kickoff)s, now()
)
"""

_UPDATE_GAME = """
update games
   set kickoff_at = %(kickoff)s, venue = %(venue)s, status = %(status)s,
       updated_at = now()
 where id = %(id)s
"""

_INSERT_REVISION = """
insert into game_schedule_revisions (
    id, game_id, kickoff_at, venue, status,
    valid_at, known_at, known_at_reconstructed, source, ingest_run_id
) values (
    gen_random_uuid(), %(game_id)s, %(kickoff)s, %(venue)s, %(status)s,
    %(valid_at)s, %(known_at)s, true, 'nflverse', %(run_id)s
)
on conflict (game_id, known_at, source) do nothing
"""


class ScheduleError(IngestError):
    """A schedule row could not be ingested (e.g. an unknown team abbr)."""


def _season_list(season_from: int | None, season_to: int | None) -> list[int]:
    if season_from is None or season_to is None:
        raise ScheduleError("schedule ingest requires --seasons (e.g. 1999-2025)")
    return list(range(season_from, season_to + 1))


def _team_abbr_to_id(cur) -> dict[str, str]:
    cur.execute("select nflverse_abbr, id from teams")
    return {abbr: tid for abbr, tid in cur.fetchall()}


def ingest_schedule(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch: Callable[[list[int]], pl.DataFrame] = fetch_schedules,
    revision_known_at: datetime | None = None,
    **_: object,
) -> None:
    seasons = _season_list(season_from, season_to)
    df = fetch(seasons)
    require_columns(df, _REQUIRED, dataset="schedule")

    # When a change is detected on re-ingest we don't know the true announcement
    # time from a bulk load, so we record "now" as the availability of the
    # revision (reconstructed). Injectable for deterministic tests.
    rev_known = revision_known_at or datetime.now(timezone.utc).replace(
        tzinfo=None, microsecond=0
    )

    written = updated = skipped = 0
    with connect() as conn:
        with conn.cursor() as cur:
            teams = _team_abbr_to_id(cur)

            for row in df.iter_rows(named=True):
                kickoff = parse_kickoff(row["gameday"], row["gametime"])
                if kickoff is None:
                    skipped += 1  # unscheduled future game; no kickoff yet
                    continue

                home = teams.get(row["home_team"])
                away = teams.get(row["away_team"])
                if home is None or away is None:
                    raise ScheduleError(
                        f"unknown team abbr in schedule: "
                        f"{row['home_team']} / {row['away_team']} "
                        "(run `sightline-ingest teams` first)"
                    )

                gid = game_id(row["game_id"])
                stype = season_type(row["game_type"])
                venue = row["stadium"]
                is_dome = row["roof"] == "dome"
                status = "completed" if row["result"] is not None else "scheduled"

                cur.execute(
                    "select kickoff_at, venue, status from games where id = %s", (gid,)
                )
                existing = cur.fetchone()

                if existing is None:
                    cur.execute(
                        _INSERT_GAME,
                        {
                            "id": gid, "season": row["season"], "week": row["week"],
                            "season_type": stype, "home": home, "away": away,
                            "venue": venue, "is_dome": is_dome, "status": status,
                            "kickoff": kickoff,
                        },
                    )
                    release = schedule_release_knownat(int(row["season"]))
                    cur.execute(
                        _INSERT_REVISION,
                        {
                            "game_id": gid, "kickoff": kickoff, "venue": venue,
                            "status": status, "valid_at": release, "known_at": release,
                            "run_id": handle.run_id,
                        },
                    )
                    written += 1
                    continue

                ex_kickoff, ex_venue, ex_status = existing
                if (kickoff, venue, status) != (ex_kickoff, ex_venue, ex_status):
                    cur.execute(
                        _UPDATE_GAME,
                        {"id": gid, "kickoff": kickoff, "venue": venue, "status": status},
                    )
                    cur.execute(
                        _INSERT_REVISION,
                        {
                            "game_id": gid, "kickoff": kickoff, "venue": venue,
                            "status": status, "valid_at": rev_known, "known_at": rev_known,
                            "run_id": handle.run_id,
                        },
                    )
                    updated += 1
                # else: unchanged — no revision, no mutation (idempotent).

        conn.commit()

    handle.rows_written = written
    handle.rows_updated = updated
    if skipped:
        handle.mark_partial(f"{skipped} games skipped (no kickoff date yet)")


register(Dataset(name="schedule", source="nflverse", run=ingest_schedule))
