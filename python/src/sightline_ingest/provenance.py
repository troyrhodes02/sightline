"""Provenance writers: ``IngestRun`` and ``SourceCoverage``.

Every ingest execution records an ``IngestRun`` — source, dataset, scope,
status, row counts, code version, and (on failure) a credential-safe error
message. Coverage is the explicit-missingness ledger: per source + dataset +
season, whether coverage is full, partial, or none.

Design guarantee — provenance survives a failed data load. The ``IngestRun`` is
written on its OWN connection, so it commits even when the data transaction rolls
back. That is what makes "a source outage produces a recorded failure, never a
silent gap" true rather than aspirational.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .db import ConnectionFactory
from .errors import sanitize_error
from ._version import code_version

# IngestStatus enum values (mirror the Prisma enum; strings by column contract).
STATUS_SUCCESS = "success"
STATUS_PARTIAL = "partial"
STATUS_DEGRADED = "degraded"
STATUS_FAILED = "failed"

_TERMINAL_OK = {STATUS_SUCCESS, STATUS_PARTIAL, STATUS_DEGRADED}


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class IngestRunHandle:
    """Mutable handle a running ingest updates as it progresses.

    The body sets ``rows_written`` / ``rows_updated`` and may downgrade status to
    ``partial`` (documented coverage gap) or ``degraded`` (fallback used). If the
    body raises, status is forced to ``failed`` regardless of what was set.
    """

    source: str
    dataset: str
    season_from: int | None = None
    season_to: int | None = None
    rows_written: int = 0
    rows_updated: int = 0
    status: str = STATUS_SUCCESS
    error_message: str | None = None
    started_at: datetime = field(default_factory=_now)

    def mark_partial(self, note: str | None = None) -> None:
        self.status = STATUS_PARTIAL
        if note:
            self.error_message = note

    def mark_degraded(self, note: str | None = None) -> None:
        self.status = STATUS_DEGRADED
        if note:
            self.error_message = note


def _write_ingest_run(
    connect: ConnectionFactory, handle: IngestRunHandle, finished_at: datetime
) -> str:
    run_id = str(uuid.uuid4())
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into ingest_runs (
                    id, source, dataset, season_from, season_to, status,
                    rows_written, rows_updated, code_version, error_message,
                    started_at, finished_at, created_at
                ) values (
                    %(id)s, %(source)s, %(dataset)s, %(season_from)s, %(season_to)s,
                    %(status)s, %(rows_written)s, %(rows_updated)s, %(code_version)s,
                    %(error_message)s, %(started_at)s, %(finished_at)s, now()
                )
                """,
                {
                    "id": run_id,
                    "source": handle.source,
                    "dataset": handle.dataset,
                    "season_from": handle.season_from,
                    "season_to": handle.season_to,
                    "status": handle.status,
                    "rows_written": handle.rows_written,
                    "rows_updated": handle.rows_updated,
                    "code_version": code_version(),
                    "error_message": handle.error_message,
                    "started_at": handle.started_at,
                    "finished_at": finished_at,
                },
            )
        conn.commit()
    return run_id


@contextmanager
def record_ingest_run(
    connect: ConnectionFactory,
    *,
    source: str,
    dataset: str,
    season_from: int | None = None,
    season_to: int | None = None,
) -> Iterator[IngestRunHandle]:
    """Record one ingest execution, succeed or fail.

    On success the run is written with its final status and row counts. If the
    body raises, the run is written with ``status = failed`` and a
    credential-safe message, then the exception re-raises so the failure is
    never swallowed. Either way exactly one ``IngestRun`` row is committed, on a
    connection independent of any data transaction.
    """
    handle = IngestRunHandle(
        source=source,
        dataset=dataset,
        season_from=season_from,
        season_to=season_to,
    )
    try:
        yield handle
    except BaseException as exc:  # noqa: BLE001 - record then re-raise, never swallow
        handle.status = STATUS_FAILED
        handle.error_message = sanitize_error(exc)
        _write_ingest_run(connect, handle, _now())
        raise
    else:
        if handle.status not in _TERMINAL_OK:
            handle.status = STATUS_SUCCESS
        _write_ingest_run(connect, handle, _now())


def upsert_source_coverage(
    conn,
    *,
    source: str,
    dataset: str,
    season: int,
    coverage: str,
    note: str | None = None,
) -> None:
    """Upsert a coverage ledger row. Idempotent on ``(source, dataset, season)``.

    ``coverage`` is one of ``"full"``, ``"partial"``, ``"none"``. A gap recorded
    here plus the absence of fact rows is how missingness stays explicit —
    distinct from a zero or a back-fill.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into source_coverage (id, source, dataset, season, coverage, note, updated_at)
            values (%(id)s, %(source)s, %(dataset)s, %(season)s, %(coverage)s, %(note)s, now())
            on conflict (source, dataset, season)
            do update set coverage = excluded.coverage,
                          note = excluded.note,
                          updated_at = now()
            """,
            {
                "id": str(uuid.uuid4()),
                "source": source,
                "dataset": dataset,
                "season": season,
                "coverage": coverage,
                "note": note,
            },
        )
