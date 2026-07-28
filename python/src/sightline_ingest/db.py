"""Direct-connection database access for the ingest runtime.

Prisma owns the schema; this module only reads and writes. It connects over the
DIRECT (non-pooled) connection with the service-role credential and bypasses RLS
by design — sanctioned precisely because this runtime never serves a user
request. No user request may ever reach this credential.
"""

from __future__ import annotations

from collections.abc import Callable
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import psycopg

from .config import ingest_dsn

# A factory that opens a fresh connection. Passed around (rather than a live
# connection) so provenance can commit on its OWN connection, independent of any
# data transaction that may roll back.
ConnectionFactory = Callable[[], psycopg.Connection]

# Query params Prisma/Supabase put on a connection URL that libpq/psycopg does
# not accept. `schema` is translated to a search_path; the rest are dropped.
_PRISMA_ONLY_PARAMS = {"schema", "pgbouncer", "connection_limit", "pool_timeout"}


def _normalize_dsn(dsn: str) -> tuple[str, str | None]:
    """Strip Prisma-only URL params from a DSN; return (clean_dsn, schema).

    Prisma connection strings carry params such as ``?schema=public`` and
    ``?pgbouncer=true`` that psycopg rejects. We remove them and surface the
    requested schema so it can be applied as a ``search_path``.
    """
    parts = urlsplit(dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    schema_values = query.get("schema")
    schema = schema_values[0] if schema_values else None
    kept = {k: v for k, v in query.items() if k not in _PRISMA_ONLY_PARAMS}
    clean = urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(kept, doseq=True), parts.fragment)
    )
    return clean, schema


def connect(dsn: str | None = None, *, autocommit: bool = False) -> psycopg.Connection:
    """Open a psycopg connection to the direct database.

    Callers own the connection lifecycle. Data writes should run inside a
    transaction so that a failure rolls back cleanly and leaves no partial,
    complete-looking dataset.
    """
    clean, schema = _normalize_dsn(dsn or ingest_dsn())
    kwargs: dict[str, object] = {"autocommit": autocommit}
    if schema:
        kwargs["options"] = f"-c search_path={schema}"
    return psycopg.connect(clean, **kwargs)


def connection_factory(dsn: str | None = None) -> ConnectionFactory:
    """Return a factory that opens fresh connections to ``dsn`` (or the default)."""
    resolved = dsn or ingest_dsn()
    return lambda: connect(resolved)
