"""Credentials never reach a surfaced error message."""

from __future__ import annotations

from sightline_ingest.errors import sanitize_error, SourceUnavailableError


def test_sanitize_removes_dsn_credentials() -> None:
    exc = SourceUnavailableError(
        "connection failed: postgresql://ingest_user:s3cretPW@db.host:5432/postgres timed out"
    )
    msg = sanitize_error(exc)
    assert "s3cretPW" not in msg
    assert "ingest_user" not in msg
    assert "<redacted>" in msg
    # The non-secret context is preserved so the failure is still diagnosable.
    assert "connection failed" in msg


def test_sanitize_removes_known_secret_value(monkeypatch) -> None:
    monkeypatch.setenv("DB_PASSWORD", "supersecretpw")
    msg = sanitize_error(Exception("auth error for password supersecretpw"))
    assert "supersecretpw" not in msg
    assert "<redacted>" in msg


def test_sanitize_accepts_plain_string() -> None:
    assert sanitize_error("nothing secret here") == "nothing secret here"
