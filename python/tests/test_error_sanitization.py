"""Credentials never reach a surfaced error message."""

from __future__ import annotations

from contextlib import contextmanager

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


def test_sanitize_removes_dsn_password_component_alone(monkeypatch) -> None:
    # The password can be quoted OUTSIDE the user:pass@host shape (e.g. a
    # server "password authentication failed" message). The value-based layer
    # must scrub the parsed password component of any configured DSN.
    monkeypatch.setenv("DIRECT_URL", "postgresql://ingest_user:lonelyPW@db.host:5432/postgres")
    msg = sanitize_error(Exception('FATAL: password "lonelyPW" was rejected'))
    assert "lonelyPW" not in msg
    assert "<redacted>" in msg


def test_known_secret_values_include_decoded_password(monkeypatch) -> None:
    from sightline_ingest.config import known_secret_values

    monkeypatch.setenv("DIRECT_URL", "postgresql://u:p%40ssw0rd@db.host:5432/postgres")
    values = known_secret_values()
    assert "p%40ssw0rd" in values  # as it appears in the DSN
    assert "p@ssw0rd" in values  # as a server might echo it back


def test_cli_unexpected_exception_is_sanitized(monkeypatch, capsys) -> None:
    # A non-IngestError escaping a dataset (driver error, library bug) must hit
    # the CLI's last-resort handler and print a credential-safe line — never a
    # raw traceback, which can embed the DSN.
    from sightline_ingest import cli
    from sightline_ingest.provenance import IngestRunHandle
    from sightline_ingest.registry import DATASETS, Dataset

    monkeypatch.setenv("DB_PASSWORD", "sneakyPW")

    @contextmanager
    def fake_record(connect, **kwargs):
        # Stand-in for record_ingest_run: yield a handle, let the body's
        # exception propagate (no database in this test).
        yield IngestRunHandle(source="nflverse", dataset="boom")

    def boom(handle, connect, season_from, season_to, /, **kwargs):
        raise RuntimeError("driver blew up: password sneakyPW rejected")

    monkeypatch.setattr(cli, "record_ingest_run", fake_record)
    monkeypatch.setitem(DATASETS, "boom", Dataset(name="boom", source="nflverse", run=boom))

    rc = cli.main(["boom", "--database-url", "postgresql://u:sneakyPW@db.host:5432/db"])
    err = capsys.readouterr().err
    assert rc == 1
    assert "sneakyPW" not in err
    assert "ingest failed unexpectedly" in err
    assert "<redacted>" in err
