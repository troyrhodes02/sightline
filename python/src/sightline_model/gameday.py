"""``sightline-model gameday`` — the game-day dispatcher (SIG-50).

Every half-hourly scheduler tick, the dispatcher selects games entering their
kickoff window from the STORED schedule at evaluation time (spec RD-Q12) —
never from a calendar rule, so Thursday night, a 9:30am London game, a
late-season Saturday, Sunday night, and Monday night are one code path, and a
flexed or postponed game follows its updated ``kickoff_at`` at the next tick.

When it selects nothing it writes nothing (RD-24): a dormant tick is not a
pipeline event, and no run row exists to launder one into a success signal.

When it selects games it runs two recorded phases, both self-deduplicating on
``(category, invocation_id)`` so a re-delivered invocation is a structural
no-op:

1. A game-day ingest pass — ``schedule`` + ``context`` required, ``weather``
   optional (the fast-moving pre-kickoff facts; pbp and stats move nightly).
2. A game-scoped recompute — ``run_project(games=selected)``, one transaction
   per game, per-game outcomes in ``pipeline_run_games``.

The cutoff for the recompute is ``now`` at dispatch, giving each projection an
honest ``information_cutoff`` >= every fact the ingest pass wrote.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sightline_ingest.cycle import (
    GAMEDAY_OPTIONAL_SOURCES,
    GAMEDAY_REQUIRED_SOURCES,
    run_cycle,
)
from sightline_ingest.db import ConnectionFactory
from sightline_ingest.pipeline import RUN_FAILED, SCOPE_GAMEDAY, manual_invocation_id

# How far before kickoff a game enters its dispatch window. Mirrors the TS
# health config's game-day window (GAMEDAY_WINDOW_HOURS = 6); the two must
# move together or health will call a healthy dispatcher late.
GAMEDAY_WINDOW_MINUTES = 360

_WINDOW_GAMES_SQL = """
    select id
      from games
     where status = 'scheduled'
       and kickoff_at > %(now)s
       and kickoff_at <= %(horizon)s
     order by kickoff_at, id
"""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def select_window_games(
    connect_: ConnectionFactory, *, now: datetime, window_minutes: int
) -> list[str]:
    """Game ids with kickoff inside ``(now, now + window]``, re-read from the
    stored schedule at every evaluation (RD-Q12)."""
    with connect_() as conn, conn.cursor() as cur:
        cur.execute(
            _WINDOW_GAMES_SQL,
            {"now": now, "horizon": now + timedelta(minutes=window_minutes)},
        )
        rows = cur.fetchall()
    return [row[0] for row in rows]


def run_gameday(
    connect_: ConnectionFactory,
    *,
    invocation_id: str | None = None,
    window_minutes: int = GAMEDAY_WINDOW_MINUTES,
    now: datetime | None = None,
) -> int:
    """Run one dispatcher tick. Returns the process exit code."""
    # Imported here, not at module top: project_live's CLI imports this module.
    from .project_live import run_project

    now = now or _now()
    invocation_id = invocation_id or manual_invocation_id()

    games = select_window_games(connect_, now=now, window_minutes=window_minutes)
    if not games:
        # RD-24: nothing selected, nothing written — no run rows, no ingest.
        print(
            f"gameday: no scheduled game inside {window_minutes}m; "
            "nothing selected, nothing recorded"
        )
        return 0

    print(f"gameday: {len(games)} game(s) in window; invocation {invocation_id}")

    ingest_status = run_cycle(
        connect_,
        invocation_id=invocation_id,
        scope=SCOPE_GAMEDAY,
        now=now,
        required_sources=GAMEDAY_REQUIRED_SOURCES,
        optional_sources=GAMEDAY_OPTIONAL_SOURCES,
    )

    # The recompute still runs after a failed ingest pass: the failure is
    # recorded and visible on /health, and a projection from the last good
    # facts with an honest cutoff beats no recompute at all this close to
    # kickoff. The cutoff is now-at-dispatch either way.
    totals = run_project(now, now=now, games=games, invocation_id=invocation_id)

    failed = ingest_status == RUN_FAILED or bool(totals.get("failed_games"))
    return 1 if failed else 0
