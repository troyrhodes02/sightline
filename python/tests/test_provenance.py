"""Provenance recording: IngestRun and SourceCoverage. Requires a database."""

from __future__ import annotations

import pytest

from sightline_ingest.provenance import (
    record_ingest_run,
    upsert_source_coverage,
)

pytestmark = pytest.mark.db


def test_success_run_records_status_counts_and_code_version(connect, clean_db) -> None:
    with record_ingest_run(
        connect, source="nflverse", dataset="players", season_from=1999, season_to=2000
    ) as handle:
        handle.rows_written = 42
        handle.rows_updated = 3

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select source, dataset, season_from, season_to, status, "
            "rows_written, rows_updated, code_version, error_message, finished_at "
            "from ingest_runs"
        )
        rows = cur.fetchall()

    assert len(rows) == 1, "exactly one IngestRun should be recorded"
    (source, dataset, sfrom, sto, status, written, updated, code_version,
     error_message, finished_at) = rows[0]
    assert (source, dataset, sfrom, sto) == ("nflverse", "players", 1999, 2000)
    assert (status, written, updated) == ("success", 42, 3)
    assert code_version, "code_version (git sha) must be recorded"
    assert error_message is None
    assert finished_at is not None


def test_partial_status_is_preserved(connect, clean_db) -> None:
    with record_ingest_run(connect, source="nflverse", dataset="context") as handle:
        handle.mark_partial("participation gap weeks 1-4")

    with connect() as conn, conn.cursor() as cur:
        cur.execute("select status, error_message from ingest_runs")
        status, note = cur.fetchone()
    assert status == "partial"
    assert note == "participation gap weeks 1-4"


def test_source_coverage_upsert_is_idempotent(connect, clean_db) -> None:
    with connect() as conn:
        upsert_source_coverage(
            conn, source="nflverse", dataset="players", season=2021, coverage="full"
        )
        upsert_source_coverage(
            conn, source="nflverse", dataset="players", season=2021,
            coverage="partial", note="revised",
        )
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("select count(*) from source_coverage where season = 2021")
            count = cur.fetchone()[0]
            cur.execute(
                "select coverage, note from source_coverage "
                "where source='nflverse' and dataset='players' and season=2021"
            )
            coverage, note = cur.fetchone()

    assert count == 1, "upsert must not duplicate on (source, dataset, season)"
    assert (coverage, note) == ("partial", "revised")
