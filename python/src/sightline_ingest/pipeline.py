"""Pipeline run recording: ``PipelineRun`` and ``PipelineRunGame`` writers.

One ``PipelineRun`` row is one logical cycle of a scheduled job category
(``ingest`` or ``recompute`` here; ``keepalive`` rows are written by the
application's pipeline routes). The row is created ``running`` BEFORE any work
begins and marked terminal only at completion, so an interrupted cycle can
never read as a success — a crashed runner leaves ``running`` behind, and the
health read treats a timed-out ``running`` row as failed.

Duplicate scheduled invocation is deduplicated structurally: ``(category,
invocation_id)`` is unique, and ``start_pipeline_run`` returns ``None`` when
the cycle was already recorded, so a re-delivered invocation performs no work
and records no second cycle.

Like provenance, every write here commits on its OWN connection, independent
of any data transaction that may roll back.

Prisma owns the schema; this module writes rows and never migrates.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .db import ConnectionFactory
from ._version import code_version

# PipelineJobCategory enum values (mirror the Prisma enum; strings by column contract).
CATEGORY_INGEST = "ingest"
CATEGORY_RECOMPUTE = "recompute"
CATEGORY_KEEPALIVE = "keepalive"

# PipelineRunStatus enum values.
RUN_RUNNING = "running"
RUN_SUCCEEDED = "succeeded"
RUN_FAILED = "failed"
RUN_INCOMPLETE = "incomplete"

# PipelineGameStatus enum values.
GAME_SUCCEEDED = "succeeded"
GAME_FAILED = "failed"
GAME_SKIPPED = "skipped"

# Scope values stored on the run row (spec: "in_week" | "gameday" | null).
SCOPE_IN_WEEK = "in_week"
SCOPE_GAMEDAY = "gameday"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def manual_invocation_id() -> str:
    """A unique invocation id for manual CLI runs.

    A fixed literal would collide on the ``(category, invocation_id)`` unique
    key and silently collapse every manual cycle into one logical run.
    """
    return f"manual:{uuid.uuid4()}"


def start_pipeline_run(
    connect: ConnectionFactory,
    *,
    category: str,
    invocation_id: str,
    scope: str | None = None,
) -> str | None:
    """Create the cycle row as ``running`` before any work.

    Returns the run id, or ``None`` when this ``(category, invocation_id)``
    already exists — the caller must then skip the cycle entirely rather than
    double-record a re-delivered scheduled invocation.
    """
    run_id = str(uuid.uuid4())
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into pipeline_runs (
                    id, category, status, invocation_id, scope,
                    code_version, started_at, created_at
                ) values (
                    %(id)s, %(category)s::"PipelineJobCategory", 'running',
                    %(invocation_id)s, %(scope)s, %(code_version)s, %(started_at)s, now()
                )
                on conflict (category, invocation_id) do nothing
                returning id
                """,
                {
                    "id": run_id,
                    "category": category,
                    "invocation_id": invocation_id,
                    "scope": scope,
                    "code_version": code_version(),
                    "started_at": _now(),
                },
            )
            row = cur.fetchone()
        conn.commit()
    return row[0] if row else None


def finish_pipeline_run(
    connect: ConnectionFactory,
    run_id: str,
    *,
    status: str,
    error_message: str | None = None,
) -> None:
    """Mark a cycle terminal. ``error_message`` must already be sanitized."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update pipeline_runs
                   set status = %(status)s::"PipelineRunStatus",
                       error_message = %(error_message)s,
                       finished_at = %(finished_at)s
                 where id = %(id)s
                """,
                {
                    "id": run_id,
                    "status": status,
                    "error_message": error_message,
                    "finished_at": _now(),
                },
            )
        conn.commit()


def record_pipeline_run_game(
    connect: ConnectionFactory,
    run_id: str,
    game_id: str,
    *,
    status: str,
    projected_count: int = 0,
    error_message: str | None = None,
) -> None:
    """Record one game's outcome within a recompute cycle.

    Upserts on ``(pipeline_run_id, game_id)`` so a retry inside one cycle
    overwrites its own row rather than duplicating it.
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into pipeline_run_games (
                    id, pipeline_run_id, game_id, status, projected_count,
                    error_message, finished_at, created_at
                ) values (
                    %(id)s, %(run_id)s, %(game_id)s,
                    %(status)s::"PipelineGameStatus", %(projected_count)s,
                    %(error_message)s, %(finished_at)s, now()
                )
                on conflict (pipeline_run_id, game_id)
                do update set status = excluded.status,
                              projected_count = excluded.projected_count,
                              error_message = excluded.error_message,
                              finished_at = excluded.finished_at
                """,
                {
                    "id": str(uuid.uuid4()),
                    "run_id": run_id,
                    "game_id": game_id,
                    "status": status,
                    "projected_count": projected_count,
                    "error_message": error_message,
                    "finished_at": _now(),
                },
            )
        conn.commit()
