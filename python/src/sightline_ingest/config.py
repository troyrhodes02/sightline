"""Environment and connection configuration for the ingest runtime.

The Python runtime connects over the DIRECT (non-pooled) connection using the
service-role credential, because large transactional loads are a poor fit for
transaction-mode pooling, and because it never serves a user request its
isolation guarantee is that it never sits in a request path.

Resolution order for the ingest DSN:
  1. ``INGEST_DATABASE_URL`` — explicit override (used by tests to point at the
     local Postgres container via ``TEST_DATABASE_URL``).
  2. ``DIRECT_URL`` — the direct Supabase connection (production/dev ingest).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit


def _load_dotenv() -> None:
    """Best-effort load of the repo-root .env for local development.

    Mirrors ``prisma.config.ts`` importing ``dotenv/config``. Does not override
    variables already present in the environment (so CI and explicit overrides
    win). A missing .env or missing python-dotenv is not an error.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - dotenv is a declared dependency
        return
    # python/src/sightline_ingest/config.py -> repo root is three parents up.
    repo_root = Path(__file__).resolve().parents[3]
    load_dotenv(repo_root / ".env", override=False)


class ConfigError(RuntimeError):
    """Raised when required configuration is missing."""


def ingest_dsn() -> str:
    """Return the direct-connection DSN for ingest, or raise ConfigError.

    The returned string is a secret (it contains the database password) and must
    never be logged, echoed, or placed in an ``IngestRun.error_message``.
    """
    _load_dotenv()
    dsn = os.environ.get("INGEST_DATABASE_URL") or os.environ.get("DIRECT_URL")
    if not dsn:
        raise ConfigError(
            "No database DSN configured. Set INGEST_DATABASE_URL or DIRECT_URL "
            "(see .env.example)."
        )
    return dsn


def known_secret_values() -> list[str]:
    """Secret substrings that must be scrubbed from any surfaced error text.

    Kept deliberately small and value-based so sanitisation never depends on a
    single regex catching every credential shape.
    """
    _load_dotenv()
    secrets: list[str] = []
    for key in ("INGEST_DATABASE_URL", "DIRECT_URL", "DATABASE_URL", "DB_PASSWORD"):
        value = os.environ.get(key)
        if not value:
            continue
        secrets.append(value)
        # Also scrub the password COMPONENT of a DSN on its own: an error
        # message may quote the password outside the user:pass@host shape the
        # structural regex needs. Both the raw (possibly percent-encoded) and
        # decoded forms are secrets.
        try:
            password = urlsplit(value).password
        except ValueError:
            password = None
        if password:
            secrets.append(password)
            decoded = unquote(password)
            if decoded != password:
                secrets.append(decoded)
    return secrets
