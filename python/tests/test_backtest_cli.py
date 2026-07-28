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


# --- season coverage gate (SIG-17: exit 2 before any run row exists) ----------


def _coverage(conn, dataset: str, seasons, coverage: str = "full") -> None:
    from sightline_ingest.provenance import upsert_source_coverage

    for season in seasons:
        upsert_source_coverage(
            conn, source="nflverse", dataset=dataset, season=season,
            coverage=coverage,
        )


def _run_count(connect) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from backtest_runs")
        return cur.fetchone()[0]


def _ingest_fixture_corpus(connect) -> None:
    from test_harness import (
        _h,
        _players_df,
        _schedule_df,
        _stats_df,
        _teams_df,
    )
    from sightline_ingest.datasets.players import ingest_players
    from sightline_ingest.datasets.schedule import ingest_schedule
    from sightline_ingest.datasets.stats import ingest_stats
    from sightline_ingest.datasets.teams import ingest_teams

    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2022, 2023,
                    fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2022, 2023, fetch=lambda s: _stats_df())


def test_run_refuses_seasons_outside_corpus_coverage_naming_the_range(
    connect, test_dsn, clean_db, capsys, tmp_path
) -> None:
    # The gate must fire BEFORE a BacktestRun row exists: exit 2 is "nothing
    # was attempted", and a rejected request must leave no partial run behind.
    # Coverage is the corpus itself: the fixture ingests 2022-2023.
    _ingest_fixture_corpus(connect)

    code = main([
        "--database-url", test_dsn, "run", "--seasons", "2024",
        "--stat-types", "receiving_yards", "--artifact-base", str(tmp_path),
    ])
    captured = capsys.readouterr()

    assert code == 2
    assert "2022-2023" in captured.err  # the covered range, named
    assert "2024" in captured.err
    assert _run_count(connect) == 0


def test_run_refuses_when_the_corpus_is_empty(
    connect, test_dsn, clean_db, capsys, tmp_path
) -> None:
    code = main([
        "--database-url", test_dsn, "run", "--seasons", "2023",
        "--stat-types", "receiving_yards", "--artifact-base", str(tmp_path),
    ])
    captured = capsys.readouterr()

    assert code == 2
    assert "no ingested seasons" in captured.err
    assert _run_count(connect) == 0


def test_run_refuses_a_season_the_ledger_marks_none(
    connect, test_dsn, clean_db, capsys, tmp_path
) -> None:
    # The ledger cannot grant coverage, but it can veto: a season explicitly
    # recorded as `none` is blocked even though stray fact rows exist.
    _ingest_fixture_corpus(connect)
    with connect() as conn:
        _coverage(conn, "stats", (2023,), coverage="none")
        conn.commit()

    code = main([
        "--database-url", test_dsn, "run", "--seasons", "2023",
        "--stat-types", "receiving_yards", "--artifact-base", str(tmp_path),
    ])
    captured = capsys.readouterr()

    assert code == 2
    assert "stats" in captured.err
    assert _run_count(connect) == 0


def test_run_proceeds_when_every_requested_season_is_covered(
    connect, test_dsn, clean_db, capsys, tmp_path
) -> None:
    # The gate must not false-positive: an ingested corpus covering the
    # requested seasons lets the run reach the harness and complete, with no
    # ledger rows required.
    _ingest_fixture_corpus(connect)

    code = main([
        "--database-url", test_dsn, "run", "--seasons", "2023",
        "--stat-types", "receiving_yards",
        "--artifact-base", str(tmp_path / "artifacts"),
    ])
    captured = capsys.readouterr()

    assert code == 0, captured.err
    assert _run_count(connect) == 1


def test_coverage_error_message_is_pure_and_names_the_gap() -> None:
    # Pure arithmetic/wording tests for the gate, no database involved.
    from sightline_model.cli import _coverage_error

    empty = {"stats": set(), "schedule": set()}
    message = _coverage_error(empty, 2019, 2023)
    assert "no ingested seasons" in message
    assert "stats" in message and "schedule" in message

    partial = {"stats": {2016, 2017, 2018, 2019, 2020, 2021},
               "schedule": {2016, 2017, 2018, 2019, 2020, 2021}}
    message = _coverage_error(partial, 2019, 2023)
    assert "2016-2021" in message  # the covered range, named
    assert "2022" in message and "2023" in message  # the missing seasons

    covered = {"stats": {2022, 2023}, "schedule": {2022, 2023}}
    assert _coverage_error(covered, 2022, 2023) is None


# --- cohort validation (usage error, before any connection) -------------------


def test_unknown_cohort_is_a_usage_error_listing_valid_cohorts(capsys) -> None:
    # Validated before a connection is opened: the DSN below is unreachable,
    # and a connection attempt would exit 1, not 2.
    dsn = "postgresql://postgres:pw@127.0.0.1:1/nope"
    code = main([
        "--database-url", dsn, "predictions", "some-run-id",
        "--cohort", "sparse_history",
    ])
    captured = capsys.readouterr()

    assert code == 2
    assert "unknown cohort" in captured.err
    for cohort in ("sparse", "low_confidence", "returning", "role_change",
                   "impossible_output"):
        assert cohort in captured.err


# --- verify --json serialization ----------------------------------------------


def test_verify_payload_serializes_findings_generically() -> None:
    # A stub with the Findings shape (checks/failures/notices/passed): the
    # serializer must iterate collections, never name a check, so checks
    # added to verify.py later appear without an edit here.
    import json as json_module
    from types import SimpleNamespace

    from sightline_model.cli import _verify_payload

    findings = SimpleNamespace(
        checks=["marker and status agree", "rng draws are zero", "new check"],
        failures=["rng draws are zero: the engine recorded 3 draws"],
        notices=["different experiment: run abcd1234"],
        passed=False,
    )
    payload = _verify_payload(findings, "run-1")

    assert payload["runId"] == "run-1"
    assert payload["passed"] is False
    by_name = {c["name"]: c for c in payload["checks"]}
    assert by_name["marker and status agree"]["passed"] is True
    assert by_name["new check"]["passed"] is True
    assert by_name["rng draws are zero"]["passed"] is False
    assert by_name["rng draws are zero"]["detail"] == "the engine recorded 3 draws"
    assert payload["notices"] == ["different experiment: run abcd1234"]
    # Round-trips through the exact dumps call the CLI uses.
    encoded = json_module.dumps(payload, indent=2, sort_keys=True, default=str)
    assert json_module.loads(encoded) == payload
