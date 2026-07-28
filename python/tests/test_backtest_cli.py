"""``sightline-backtest`` wiring (SIG-13).

Proves the entry point resolves a DSN, opens the direct connection, reads, and
prints — end to end — before any modelling code exists to obscure a failure.
Also pins two behaviours that are easy to get wrong later: an empty list is a
result rather than an error, and a connection failure never prints the DSN.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from sightline_model.cli import main
from sightline_model.persist import holdout_model_versions, list_runs
from test_backtest_schema import insert_run

pytestmark = pytest.mark.db


def test_list_with_no_runs_prints_a_header_and_succeeds(
    test_dsn, clean_db, capsys
) -> None:
    # Before the first backtest there are legitimately zero runs. Rendering
    # that as a failure would train the operator to ignore the exit code.
    code = main(["--database-url", test_dsn, "list"])
    out = capsys.readouterr().out

    assert code == 0
    assert "run" in out and "status" in out and "model version" in out
    assert "(no runs stored)" in out


def test_list_renders_a_stored_run(connect, test_dsn, clean_db, capsys) -> None:
    with connect() as conn:
        insert_run(conn, model_version="baseline-zil-0.1.0")
        conn.commit()

    code = main(["--database-url", test_dsn, "list"])
    out = capsys.readouterr().out

    assert code == 0
    assert "baseline-zil-0.1.0" in out
    assert "2019-2023" in out
    assert "development" in out
    # A run in flight has no comparison population to report, and must not
    # render a zero that reads like a measured result.
    assert "—" in out


def test_list_json_is_machine_readable(connect, test_dsn, clean_db, capsys) -> None:
    import json

    with connect() as conn:
        insert_run(conn)
        conn.commit()

    code = main(["--database-url", test_dsn, "list", "--json"])
    payload = json.loads(capsys.readouterr().out)

    assert code == 0
    assert len(payload) == 1
    row = payload[0]
    assert row["modelVersion"] == "baseline-zil-0.1.0"
    assert row["statTypes"] == ["rushing_yards", "receiving_yards"]
    assert row["isResult"] is False  # status is `running`
    assert row["corpusDigest"] == "corpus-digest"


def test_list_filters_by_model_version(connect, test_dsn, clean_db, capsys) -> None:
    with connect() as conn:
        insert_run(conn, id="11111111-1111-1111-1111-111111111111",
                   model_version="baseline-zil-0.1.0")
        insert_run(conn, id="22222222-2222-2222-2222-222222222222",
                   model_version="baseline-zil-0.2.0")
        conn.commit()

    main(["--database-url", test_dsn, "list", "--model-version", "baseline-zil-0.2.0"])
    out = capsys.readouterr().out

    assert "baseline-zil-0.2.0" in out
    assert "baseline-zil-0.1.0" not in out


def test_holdout_listing_counts_model_versions(
    connect, test_dsn, clean_db, capsys
) -> None:
    # The holdout is meant to be touched once per model version. The count IS
    # the selection-bias record, so it is printed rather than merely stored.
    with connect() as conn:
        insert_run(conn, id="11111111-1111-1111-1111-111111111111",
                   evaluation_window="holdout", model_version="baseline-zil-0.1.0")
        insert_run(conn, id="22222222-2222-2222-2222-222222222222",
                   evaluation_window="holdout", model_version="baseline-zil-0.2.0")
        insert_run(conn, id="33333333-3333-3333-3333-333333333333",
                   evaluation_window="development", model_version="baseline-zil-0.3.0")
        conn.commit()

    code = main(["--database-url", test_dsn, "list", "--window", "holdout"])
    out = capsys.readouterr().out

    assert code == 0
    assert "holdout touched by 2 model version(s)" in out
    assert "baseline-zil-0.3.0" not in out


def test_runs_are_ordered_newest_first_with_a_stable_tiebreak(
    connect, clean_db
) -> None:
    # Two runs started in the same millisecond must still order
    # deterministically; an unordered result set feeding output is a defect
    # even when the values are identical.
    same_instant = datetime(2026, 7, 28, 11, 47, tzinfo=timezone.utc)
    with connect() as conn:
        insert_run(conn, id="aaaaaaaa-0000-0000-0000-000000000000",
                   started_at=same_instant)
        insert_run(conn, id="bbbbbbbb-0000-0000-0000-000000000000",
                   started_at=same_instant)
        conn.commit()

    first = [r.id for r in list_runs(connect)]
    second = [r.id for r in list_runs(connect)]
    assert first == second
    assert first[0].startswith("bbbbbbbb")


def test_holdout_model_versions_is_empty_without_holdout_runs(
    connect, clean_db
) -> None:
    with connect() as conn:
        insert_run(conn, evaluation_window="development")
        conn.commit()
    assert holdout_model_versions(connect) == []


def test_connection_failure_never_prints_the_dsn(capsys) -> None:
    # A raw psycopg OperationalError embeds the DSN's host and username. The
    # console path is sanitized for the same reason IngestRun.error_message is.
    dsn = "postgresql://postgres:sup3rs3cret@127.0.0.1:1/nope"
    code = main(["--database-url", dsn, "list"])
    captured = capsys.readouterr()

    assert code == 1
    combined = captured.out + captured.err
    assert "sup3rs3cret" not in combined
    assert "backtest command failed" in combined
