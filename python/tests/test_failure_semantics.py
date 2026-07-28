"""Explicit-failure semantics: a source outage records a failed run, re-raises,
and leaves no partial data behind. Requires a database."""

from __future__ import annotations

import uuid

import pytest

from sightline_ingest.errors import SourceUnavailableError
from sightline_ingest.provenance import record_ingest_run

pytestmark = pytest.mark.db


def test_outage_records_failed_reraises_and_commits_no_partial_data(
    connect, clean_db
) -> None:
    secret_dsn = "postgresql://ingest_user:topsecretpw@db.host:5432/postgres"

    with pytest.raises(SourceUnavailableError):
        with record_ingest_run(connect, source="nflverse", dataset="pbp") as handle:
            # A partial data write that must be rolled back when the source fails.
            with connect() as data_conn:
                with data_conn.cursor() as cur:
                    cur.execute(
                        "insert into teams (id, nflverse_abbr, full_name, updated_at) "
                        "values (%s, 'ZZ', 'Ghost Team', now())",
                        (str(uuid.uuid4()),),
                    )
                handle.rows_written = 1
                # Source dies mid-ingest; raising here rolls back data_conn.
                raise SourceUnavailableError(f"nflverse unreachable via {secret_dsn}")

    with connect() as conn, conn.cursor() as cur:
        cur.execute("select status, error_message from ingest_runs")
        status, message = cur.fetchone()
        cur.execute("select count(*) from teams")
        team_count = cur.fetchone()[0]

    # The run is recorded as an explicit failure...
    assert status == "failed"
    # ...with a credential-safe message...
    assert message is not None
    assert "topsecretpw" not in message
    assert "ingest_user" not in message
    # ...and NO partial dataset was committed.
    assert team_count == 0


def test_schema_drift_can_be_raised_as_failure(connect, clean_db) -> None:
    from sightline_ingest.errors import SchemaDriftError

    with pytest.raises(SchemaDriftError):
        with record_ingest_run(connect, source="nflverse", dataset="stats"):
            raise SchemaDriftError("required column 'receiving_yards' missing upstream")

    with connect() as conn, conn.cursor() as cur:
        cur.execute("select status from ingest_runs")
        assert cur.fetchone()[0] == "failed"
