"""Shared pytest fixtures.

DB integration tests use ``TEST_DATABASE_URL`` (the local Postgres container),
never the remote dev database. Tests marked ``db`` skip automatically when it is
unset, so the import-graph and sanitisation tests still run anywhere.
"""

from __future__ import annotations

import os

import pytest

from sightline_ingest.config import _load_dotenv
from sightline_ingest.db import connection_factory

# Tables truncated between DB tests. Order does not matter with CASCADE.
_RESET_TABLES = "ingest_runs, source_coverage, teams"


@pytest.fixture(scope="session")
def test_dsn() -> str:
    _load_dotenv()
    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("TEST_DATABASE_URL not set; skipping DB integration test")
    return dsn


@pytest.fixture
def connect(test_dsn: str):
    """A connection factory pointed at the test database."""
    return connection_factory(test_dsn)


@pytest.fixture
def clean_db(connect):
    """Truncate provenance + reference tables around each DB test."""

    def _truncate() -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f"truncate {_RESET_TABLES} restart identity cascade;")
            conn.commit()

    _truncate()
    yield
    _truncate()
