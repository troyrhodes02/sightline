"""``sightline-ingest cycle`` — one scheduled in-season ingest cycle.

Runs the registered live datasets in a fixed order inside one recorded
``PipelineRun``, linking each per-dataset ``IngestRun`` to the cycle via
``pipeline_run_id``. Partial success is honest (spec RD-P7 / RD-26):

* Required sources: ``schedule``, ``pbp``, ``stats``, ``context``. Any of
  them failing marks the cycle ``failed`` — after the remaining sources have
  still been run, so one outage never conceals another.
* Optional sources: ``weather``. A failed or degraded optional source leaves
  the cycle's aggregate success intact; the per-source ``IngestRun`` row keeps
  the detail visible.

The season window is derived from the stored schedule at evaluation time:
the seasons of scheduled games inside the lookahead window. When no game is
upcoming (offseason), the cycle exits without writing any run row — a
dormant scheduler tick is not a pipeline event.

Duplicate scheduled invocation (same ``--invocation-id``) records nothing and
re-runs nothing: the ``(category, invocation_id)`` unique key makes the second
delivery a structural no-op.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from .config import ConfigError, ingest_dsn
from .db import ConnectionFactory, connection_factory
from .errors import sanitize_error
from .pipeline import (
    CATEGORY_INGEST,
    RUN_FAILED,
    RUN_SUCCEEDED,
    SCOPE_IN_WEEK,
    finish_pipeline_run,
    manual_invocation_id,
    start_pipeline_run,
)
from .provenance import STATUS_FAILED, record_ingest_run
from .registry import get as get_dataset

REQUIRED_SOURCES: tuple[str, ...] = ("schedule", "pbp", "stats", "context")
OPTIONAL_SOURCES: tuple[str, ...] = ("weather",)

# The game-day dispatcher's ingest pass (spec: "game-scoped context/schedule/
# weather ingest"). Only the fast-moving pre-kickoff facts; pbp and stats move
# on the nightly cadence, not within a kickoff window.
GAMEDAY_REQUIRED_SOURCES: tuple[str, ...] = ("schedule", "context")
GAMEDAY_OPTIONAL_SOURCES: tuple[str, ...] = ("weather",)

# How far ahead the in-week cycle looks for scheduled games. Mirrors the TS
# health config's SEASON_LOOKAHEAD_DAYS: the two runtimes must share this
# value, or at season start the cycle would run (and could fail) while /health
# still derives not_expected — which takes precedence and hides the failure.
LOOKAHEAD_DAYS = 7


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def upcoming_season_window(
    connect: ConnectionFactory, *, now: datetime
) -> tuple[int, int] | None:
    """Seasons of scheduled games inside the lookahead, from the stored
    schedule at evaluation time — never from a calendar rule."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select min(season), max(season)
              from games
             where status = 'scheduled'
               and kickoff_at > %(now)s
               and kickoff_at <= %(horizon)s
            """,
            {"now": now, "horizon": now + timedelta(days=LOOKAHEAD_DAYS)},
        )
        row = cur.fetchone()
    if row is None or row[0] is None:
        return None
    return int(row[0]), int(row[1])


def run_cycle(
    connect: ConnectionFactory,
    *,
    invocation_id: str | None = None,
    scope: str = SCOPE_IN_WEEK,
    now: datetime | None = None,
    required_sources: tuple[str, ...] = REQUIRED_SOURCES,
    optional_sources: tuple[str, ...] = OPTIONAL_SOURCES,
) -> str:
    """Run one ingest cycle. Returns the recorded terminal status, or
    ``"not_expected"`` / ``"duplicate"`` when no run row was written."""
    now = now or _now()
    invocation_id = invocation_id or manual_invocation_id()

    window = upcoming_season_window(connect, now=now)
    if window is None:
        print(
            "cycle: no scheduled game within "
            f"{LOOKAHEAD_DAYS} days; not expected, nothing recorded"
        )
        return "not_expected"
    season_from, season_to = window

    run_id = start_pipeline_run(
        connect,
        category=CATEGORY_INGEST,
        invocation_id=invocation_id,
        scope=scope,
    )
    if run_id is None:
        print(f"cycle: invocation {invocation_id!r} already recorded; skipping")
        return "duplicate"

    failed_required: list[str] = []
    try:
        for name in (*required_sources, *optional_sources):
            dataset = get_dataset(name)
            if dataset is None:
                # A registered-source list naming an unknown dataset is a code
                # bug, and for a required source it must fail the cycle loudly.
                if name in required_sources:
                    failed_required.append(name)
                print(f"cycle: dataset {name!r} is not registered", file=sys.stderr)
                continue
            try:
                with record_ingest_run(
                    connect,
                    source=dataset.source,
                    dataset=dataset.name,
                    season_from=season_from,
                    season_to=season_to,
                    pipeline_run_id=run_id,
                ) as handle:
                    dataset.run(
                        handle,
                        connect,
                        season_from,
                        season_to,
                        source=None,
                        from_samples=None,
                    )
            except Exception as exc:  # noqa: BLE001 - recorded per source; cycle continues
                # The per-source failure is already recorded as a failed
                # IngestRun by record_ingest_run. Remaining sources still run:
                # one outage must not conceal another source's state.
                print(f"cycle: {name} failed: {sanitize_error(exc)}", file=sys.stderr)
                if name in required_sources:
                    failed_required.append(name)
            else:
                if handle.status == STATUS_FAILED and name in required_sources:
                    failed_required.append(name)
    except BaseException as exc:
        # Interrupt or unexpected fatal error: record what we know, re-raise.
        # The recording attempt must never mask the original traceback — if
        # the fatal cause is a lost DB connection, this write fails too, and
        # the run row still turns failed via the health read's running
        # timeout.
        try:
            finish_pipeline_run(
                connect, run_id, status=RUN_FAILED, error_message=sanitize_error(exc)
            )
        except Exception as record_exc:  # noqa: BLE001 - deliberate: original error wins
            print(
                f"cycle: could not record fatal failure: {sanitize_error(record_exc)}",
                file=sys.stderr,
            )
        raise

    status = RUN_FAILED if failed_required else RUN_SUCCEEDED
    error_message = (
        f"required source(s) failed: {', '.join(sorted(failed_required))}"
        if failed_required
        else None
    )
    finish_pipeline_run(connect, run_id, status=status, error_message=error_message)
    print(f"cycle: {status} (seasons {season_from}-{season_to})")
    return status


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sightline-ingest cycle",
        description="Run one scheduled in-season ingest cycle.",
    )
    parser.add_argument(
        "--scope",
        choices=["in-week"],
        default="in-week",
        help="cycle scope (in-week: the recurring nightly cycle)",
    )
    parser.add_argument(
        "--invocation-id",
        default=None,
        help="scheduler invocation id (e.g. the GitHub Actions run id); "
        "defaults to a unique manual id",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="override the ingest DSN (defaults to INGEST_DATABASE_URL / DIRECT_URL)",
    )
    args = parser.parse_args(argv)

    try:
        dsn = args.database_url or ingest_dsn()
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    connect = connection_factory(dsn)
    status = run_cycle(
        connect,
        invocation_id=args.invocation_id,
        scope=args.scope.replace("-", "_"),
    )
    return 1 if status == RUN_FAILED else 0
