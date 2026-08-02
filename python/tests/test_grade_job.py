"""The grading job (SIG-52): structure, idempotence, corrections, isolation.

The structural tests prove the SQL touches only sanctioned tables and columns.
The DB tests attack the properties that matter: a re-run writes nothing, a
correction regrades only what it touched, an interrupted run leaves no partial
game, grading mutates nothing outside the grade tables, and the stored
baselines are as-of the projection's own cutoff — a stat published after the
cutoff must not move them.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta

import pytest

from sightline_ingest.grade_job import (
    _ELIGIBLE_SQL,
    _MARKET_THRESHOLDS_SQL,
    _prob_above,
    _rehydrate,
    run_grade,
)
from sightline_model.distributions import (
    KIND_NB,
    KIND_ZIL,
    DistributionError,
    NegativeBinomial,
    ZeroInflatedLogNormal,
)
from sightline_model.stat_types import spec as stat_spec

# ---------------------------------------------------------------------------
# Structural: sanctioned tables and columns only
# ---------------------------------------------------------------------------


def test_sql_touches_no_market_history_table() -> None:
    for sql in (_ELIGIBLE_SQL, _MARKET_THRESHOLDS_SQL):
        lowered = sql.lower()
        assert "price" not in lowered
        assert "snapshot" not in lowered
        assert "decision" not in lowered


def test_market_threshold_sql_reads_identity_and_threshold_only() -> None:
    referenced = set(re.findall(r"\bc\.(\w+)", _MARKET_THRESHOLDS_SQL))
    assert referenced <= {
        "id",
        "player_id",
        "game_id",
        "stat_type",
        "threshold",
        "resolution_status",
        "first_seen_at",
    }, f"contract read must stay identity+threshold, found: {sorted(referenced)}"


# ---------------------------------------------------------------------------
# Unit: rehydration and strict-inequality threshold probability
# ---------------------------------------------------------------------------


def test_prob_above_is_strict_for_integer_count_thresholds() -> None:
    dist = NegativeBinomial(r=4.0, p=0.5, cap=15)
    # P(X > 3) must be P(X >= 4), not prob_at_least(3) which answers >=.
    assert _prob_above(dist, 3.0) == pytest.approx(dist.prob_at_least(4.0))
    assert _prob_above(dist, 3.0) != pytest.approx(dist.prob_at_least(3.0))
    # For the .5-valued grids, > and >= coincide and the nudge is a no-op.
    assert _prob_above(dist, 2.5) == pytest.approx(dist.prob_at_least(2.5))


def test_rehydrate_rebuilds_both_families_and_rejects_unknown() -> None:
    zil = _rehydrate(KIND_ZIL, {"p_zero": 0.05, "mu": 4.2, "sigma": 0.45}, None)
    assert isinstance(zil, ZeroInflatedLogNormal)
    nb = _rehydrate(KIND_NB, {"r": 4.0, "p": 0.5}, [0.0] * 16)
    assert isinstance(nb, NegativeBinomial)
    assert nb.cap == 15
    with pytest.raises(DistributionError):
        _rehydrate("mystery_kind", {}, None)


# ---------------------------------------------------------------------------
# DB integration: seed, grade, attack
# ---------------------------------------------------------------------------

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _uid(key: str) -> str:
    return str(uuid.uuid5(_NS, f"test-grade-job:{key}"))


KICKOFF_G1 = datetime(2025, 11, 2, 17, 0)
CUTOFF_G1 = KICKOFF_G1 - timedelta(minutes=90)
KICKOFF_G2 = datetime(2025, 11, 9, 17, 0)
CUTOFF_G2 = KICKOFF_G2 - timedelta(minutes=90)
NOW = datetime(2025, 11, 10, 9, 0)

ZIL_PARAMS = {"p_zero": 0.05, "mu": 4.2, "sigma": 0.45}
# History receiving yards. Season average 2025 = (95+42+110+71)/4 = 79.5;
# trailing five = (60+95+42+110+71)/5 = 75.6.
HISTORY_2024 = (50.0, 60.0)
HISTORY_2025 = (95.0, 42.0, 110.0, 71.0)
OFFICIAL_G1 = 88.0
PROJECTED_VALUE = 78.0
PROJECTED_MEDIAN = 72.0


def _insert_game(cur, key: str, season: int, week: int, kickoff: datetime,
                 status: str) -> None:
    cur.execute(
        "insert into games (id, season, week, season_type, home_team_id,"
        " away_team_id, is_dome, status, kickoff_at, created_at, updated_at)"
        " values (%s,%s,%s,'REG',%s,%s,false,%s::\"GameStatus\",%s,now(),now())",
        (_uid(key), season, week, _uid("team-BAL"), _uid("team-CIN"),
         status, kickoff),
    )


def _insert_stat(cur, key: str, game_key: str, yards: float,
                 known_at: datetime, *, version: int = 1) -> None:
    cur.execute(
        "insert into player_game_stats (id, player_id, game_id,"
        " team_abbr_at_game, receiving_yards, version, valid_at, known_at,"
        " known_at_reconstructed, source, ingest_run_id, created_at, updated_at)"
        " values (%s,%s,%s,'CIN',%s,%s,%s,%s,true,'nflverse',%s,now(),now())",
        (_uid(key), _uid("player"), _uid(game_key), yards, version,
         known_at, known_at, _uid("ingest-run")),
    )


def _insert_projection(cur, key: str, game_key: str, *, stat_type: str,
                       kind: str, params: dict, pmf: list | None,
                       cutoff: datetime, computed_at: datetime,
                       projected_value: float = PROJECTED_VALUE,
                       projected_median: float = PROJECTED_MEDIAN) -> str:
    row_id = _uid(key)
    cur.execute(
        "insert into projections (id, player_id, game_id, stat_type,"
        " model_version, distribution_kind, params, quantiles, pmf,"
        " projected_value, projected_median, interval_low, interval_high,"
        " confidence, n_eff, computed_at, information_cutoff, created_at)"
        " values (%s,%s,%s,%s::\"StatType\",'baseline-zil-0.1.0',%s,%s,%s,%s,"
        " %s,%s,40.0,120.0,'medium'::\"Confidence\",6,%s,%s,now())",
        (row_id, _uid("player"), _uid(game_key), stat_type, kind,
         json.dumps(params), json.dumps({"q50": projected_median}),
         json.dumps(pmf) if pmf is not None else None,
         projected_value, projected_median, computed_at, cutoff),
    )
    return row_id


def _insert_contract(cur, key: str, game_key: str, *, threshold: float,
                     ticker: str, resolution: str = "resolved",
                     first_seen: datetime | None = None) -> str:
    row_id = _uid(key)
    cur.execute(
        "insert into contracts (id, kalshi_ticker, title, kalshi_player_name,"
        " player_id, game_id, stat_type, threshold, resolution_status, status,"
        " first_seen_at, last_seen_at, created_at, updated_at)"
        " values (%s,%s,%s,%s,%s,%s,'receiving_yards'::\"StatType\",%s,"
        " %s::\"IdentityResolutionStatus\", 'active'::\"ContractStatus\","
        " %s, now(), now(), now())",
        (row_id, ticker, "Ja'Marr Chase receiving yards", "Ja'Marr Chase",
         _uid("player"), _uid(game_key), threshold, resolution,
         first_seen or datetime(2025, 10, 27, 12, 0)),
    )
    return row_id


def _seed_base(connect) -> None:
    """Teams, player, history, one completed game with stat + projections +
    contracts, plus a snapshot and a decision that grading must never touch."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into teams (id, nflverse_abbr, full_name, created_at, updated_at)"
            " values (%s,%s,%s,now(),now()), (%s,%s,%s,now(),now())",
            (_uid("team-CIN"), "CIN", "Cincinnati Bengals",
             _uid("team-BAL"), "BAL", "Baltimore Ravens"),
        )
        cur.execute(
            "insert into players (id, full_name, position, created_at, updated_at)"
            " values (%s,%s,%s,now(),now())",
            (_uid("player"), "Ja'Marr Chase", "WR"),
        )
        for week, yards in enumerate(HISTORY_2024, start=1):
            key = f"game-2024-w{week}"
            kickoff = datetime(2024, 9, 1 + week * 7, 17, 0)
            _insert_game(cur, key, 2024, week, kickoff, "completed")
            _insert_stat(cur, f"stat-2024-w{week}", key, yards,
                         kickoff + timedelta(days=1))
        for week, yards in enumerate(HISTORY_2025, start=1):
            key = f"game-2025-w{week}"
            kickoff = datetime(2025, 9, 1 + week * 7, 17, 0)
            _insert_game(cur, key, 2025, week, kickoff, "completed")
            _insert_stat(cur, f"stat-2025-w{week}", key, yards,
                         kickoff + timedelta(days=1))

        _insert_game(cur, "g1", 2025, 9, KICKOFF_G1, "completed")
        _insert_stat(cur, "stat-g1", "g1", OFFICIAL_G1,
                     KICKOFF_G1 + timedelta(hours=16))
        _insert_projection(
            cur, "proj-g1", "g1", stat_type="receiving_yards",
            kind=KIND_ZIL, params=ZIL_PARAMS, pmf=None,
            cutoff=CUTOFF_G1, computed_at=KICKOFF_G1 - timedelta(hours=2),
        )
        contract_id = _insert_contract(
            cur, "contract-74", "g1", threshold=74.5,
            ticker="KXNFLRECYDS-25NOV02-JC-74.5",
        )
        # A relisting at the SAME threshold: one market observation, not two.
        # Listed later, so the original contract deterministically wins.
        _insert_contract(
            cur, "contract-74-relist", "g1", threshold=74.5,
            ticker="KXNFLRECYDS-25NOV02-JC-74.5-RELIST",
            first_seen=datetime(2025, 10, 28, 12, 0),
        )
        # An unresolved contract must contribute no market threshold.
        _insert_contract(
            cur, "contract-unresolved", "g1", threshold=99.5,
            ticker="KXNFLRECYDS-25NOV02-JC-99.5", resolution="unresolved",
        )

        # A snapshot and a decision on the graded contract: grading must
        # leave both byte-identical.
        cur.execute(
            "insert into recommendation_snapshots (id, contract_id,"
            " is_recommended, threshold_points, trigger, created_at)"
            " values (%s,%s,true,5.0,'final_pre_kickoff'::\"SnapshotTrigger\",now())",
            (_uid("snapshot"), contract_id),
        )
        # users is access-model state and is not in the conftest reset list;
        # the seed is idempotent instead so back-to-back tests reuse the row.
        cur.execute(
            "insert into users (id, email, updated_at)"
            " values (%s,%s,now()) on conflict (id) do nothing",
            (_uid("user"), "grade-test@example.com"),
        )
        cur.execute(
            "insert into decisions (id, contract_id, user_id, disposition)"
            " values (%s,%s,%s,'took'::\"Disposition\")",
            (_uid("decision"), contract_id, _uid("user")),
        )
        conn.commit()


def _seed_g2(connect, *, with_stat: bool = True) -> None:
    with connect() as conn, conn.cursor() as cur:
        _insert_game(cur, "g2", 2025, 10, KICKOFF_G2, "completed")
        if with_stat:
            _insert_stat(cur, "stat-g2", "g2", 64.0,
                         KICKOFF_G2 + timedelta(hours=16))
        _insert_projection(
            cur, "proj-g2", "g2", stat_type="receiving_yards",
            kind=KIND_ZIL, params=ZIL_PARAMS, pmf=None,
            cutoff=CUTOFF_G2, computed_at=KICKOFF_G2 - timedelta(hours=2),
        )
        conn.commit()


def _grade_rows(connect, table: str = "projection_grades") -> dict[str, dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"select * from {table} order by id")
        cols = [d.name for d in cur.description]
        return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}


def _table_rows(connect, table: str) -> list[tuple]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"select * from {table} order by id")
        return cur.fetchall()


def _run_rows(connect) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select category, status, invocation_id from pipeline_runs"
            " order by started_at"
        )
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _game_rows(connect) -> dict[str, dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select game_id, status, projected_count, error_message"
            " from pipeline_run_games"
        )
        cols = [d.name for d in cur.description]
        return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}


def _grade_for(connect, projection_key: str) -> dict | None:
    rows = [
        r for r in _grade_rows(connect).values()
        if r["projection_id"] == _uid(projection_key)
    ]
    return rows[0] if rows else None


def _thresholds_for(connect, projection_key: str) -> list[dict]:
    rows = [
        r for r in _grade_rows(connect, "threshold_grades").values()
        if r["projection_id"] == _uid(projection_key)
    ]
    return sorted(rows, key=lambda r: (r["threshold_source"], r["threshold"]))


@pytest.mark.db
def test_grade_writes_projection_and_threshold_grades(connect, clean_db) -> None:
    _seed_base(connect)
    _seed_g2(connect)

    status = run_grade(connect, invocation_id="gh-grade-1", now=NOW)
    assert status == "succeeded"

    grade = _grade_for(connect, "proj-g1")
    assert grade is not None
    assert grade["status"] == "graded"
    assert float(grade["official_value"]) == pytest.approx(OFFICIAL_G1)
    assert grade["graded_stat_version"] == 1
    assert grade["contract_like"] is True
    assert float(grade["abs_error_mean"]) == pytest.approx(10.0)
    assert float(grade["abs_error_median"]) == pytest.approx(16.0)
    # Season average 79.5, trailing five 75.6 — from pre-cutoff history only.
    assert float(grade["season_avg_abs_error"]) == pytest.approx(8.5)
    assert float(grade["trailing_five_abs_error"]) == pytest.approx(12.4)

    thresholds = _thresholds_for(connect, "proj-g1")
    grid = stat_spec("receiving_yards").thresholds
    policy = [t for t in thresholds if t["threshold_source"] == "policy"]
    market = [t for t in thresholds if t["threshold_source"] == "market"]
    assert [float(t["threshold"]) for t in policy] == [float(t) for t in grid]
    # One market observation: the relisting deduped, the unresolved excluded.
    assert [float(t["threshold"]) for t in market] == [74.5]
    assert market[0]["contract_id"] == _uid("contract-74")
    assert all(t["contract_id"] is None for t in policy)

    dist = ZeroInflatedLogNormal(**ZIL_PARAMS)
    for row in thresholds:
        t = float(row["threshold"])
        assert float(row["stated_probability"]) == pytest.approx(
            dist.prob_at_least(t + 1e-9), abs=1e-5
        )
        assert row["outcome"] == (OFFICIAL_G1 > t)
        assert row["graded_stat_version"] == 1
        assert row["contract_like"] is True

    runs = _run_rows(connect)
    assert runs == [
        {"category": "grading", "status": "succeeded", "invocation_id": "gh-grade-1"}
    ]
    games = _game_rows(connect)
    assert games[_uid("g1")]["status"] == "succeeded"
    assert games[_uid("g1")]["projected_count"] == 1
    assert games[_uid("g2")]["status"] == "succeeded"


@pytest.mark.db
def test_only_the_latest_pre_kickoff_projection_is_graded(connect, clean_db) -> None:
    _seed_base(connect)
    with connect() as conn, conn.cursor() as cur:
        # A superseded working state (earlier cutoff) and an inadmissible one
        # (cutoff after kickoff): neither may receive a grade.
        _insert_projection(
            cur, "proj-g1-early", "g1", stat_type="receiving_yards",
            kind=KIND_ZIL, params=ZIL_PARAMS, pmf=None,
            cutoff=CUTOFF_G1 - timedelta(days=2),
            computed_at=KICKOFF_G1 - timedelta(days=2),
        )
        _insert_projection(
            cur, "proj-g1-late", "g1", stat_type="receiving_yards",
            kind=KIND_ZIL, params=ZIL_PARAMS, pmf=None,
            cutoff=KICKOFF_G1 + timedelta(minutes=5),
            computed_at=KICKOFF_G1 + timedelta(minutes=5),
        )
        conn.commit()

    run_grade(connect, invocation_id="gh-grade-2", now=NOW)

    assert _grade_for(connect, "proj-g1") is not None
    assert _grade_for(connect, "proj-g1-early") is None
    assert _grade_for(connect, "proj-g1-late") is None


@pytest.mark.db
def test_rerun_with_nothing_changed_writes_nothing(connect, clean_db) -> None:
    _seed_base(connect)
    _seed_g2(connect)

    run_grade(connect, invocation_id="gh-grade-3", now=NOW)
    grades_before = _table_rows(connect, "projection_grades")
    thresholds_before = _table_rows(connect, "threshold_grades")

    status = run_grade(
        connect, invocation_id="gh-grade-3b", now=NOW + timedelta(hours=6)
    )

    assert status == "not_expected"
    assert _table_rows(connect, "projection_grades") == grades_before
    assert _table_rows(connect, "threshold_grades") == thresholds_before
    assert len(_run_rows(connect)) == 1, (
        "an all-graded corpus is dormancy, not a recorded no-op cycle"
    )


@pytest.mark.db
def test_duplicate_invocation_records_and_writes_nothing(connect, clean_db) -> None:
    _seed_base(connect)
    run_grade(connect, invocation_id="gh-grade-4", now=NOW)
    with connect() as conn, conn.cursor() as cur:
        # Force re-selection so only the invocation-id dedup can stop the run.
        cur.execute("delete from threshold_grades")
        cur.execute("delete from projection_grades")
        conn.commit()

    status = run_grade(connect, invocation_id="gh-grade-4", now=NOW)

    assert status == "duplicate"
    assert len(_run_rows(connect)) == 1
    assert _grade_rows(connect) == {}, "a duplicate invocation must do no work"


@pytest.mark.db
def test_correction_regrades_only_the_affected_game(connect, clean_db) -> None:
    _seed_base(connect)
    _seed_g2(connect)
    run_grade(connect, invocation_id="gh-grade-5", now=NOW)

    projections_before = _table_rows(connect, "projections")
    snapshots_before = _table_rows(connect, "recommendation_snapshots")
    decisions_before = _table_rows(connect, "decisions")
    g2_grade_before = _grade_for(connect, "proj-g2")
    g2_thresholds_before = _thresholds_for(connect, "proj-g2")

    # A stat correction lands: 88.0 -> 102.0, version 2, correction row kept.
    corrected = 102.0
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update player_game_stats set receiving_yards = %s, version = 2,"
            " known_at = %s, updated_at = now() where id = %s",
            (corrected, NOW + timedelta(days=1), _uid("stat-g1")),
        )
        cur.execute(
            "insert into player_game_stat_corrections (id, player_game_stat_id,"
            " version, prior_values, corrected_values, correction_known_at,"
            " source, ingest_run_id, created_at)"
            " values (%s,%s,2,%s,%s,%s,'nflverse',%s,now())",
            (_uid("correction"), _uid("stat-g1"),
             json.dumps({"receiving_yards": OFFICIAL_G1}),
             json.dumps({"receiving_yards": corrected}),
             NOW + timedelta(days=1), _uid("ingest-run")),
        )
        conn.commit()

    later = NOW + timedelta(days=1, hours=2)
    status = run_grade(connect, invocation_id="gh-grade-5b", now=later)
    assert status == "succeeded"

    grade = _grade_for(connect, "proj-g1")
    assert float(grade["official_value"]) == pytest.approx(corrected)
    assert grade["graded_stat_version"] == 2
    assert float(grade["abs_error_mean"]) == pytest.approx(corrected - PROJECTED_VALUE)
    for row in _thresholds_for(connect, "proj-g1"):
        assert row["graded_stat_version"] == 2
        assert row["outcome"] == (corrected > float(row["threshold"]))
    # 94.5 flipped: 88.0 was under it, 102.0 clears it.
    flipped = [
        r for r in _thresholds_for(connect, "proj-g1")
        if float(r["threshold"]) == 94.5 and r["threshold_source"] == "policy"
    ]
    assert flipped and flipped[0]["outcome"] is True

    # The unaffected game's rows are byte-identical, and nothing outside the
    # grade tables moved — regrading is an update to derived data only.
    assert _grade_for(connect, "proj-g2") == g2_grade_before
    assert _thresholds_for(connect, "proj-g2") == g2_thresholds_before
    assert _table_rows(connect, "projections") == projections_before
    assert _table_rows(connect, "recommendation_snapshots") == snapshots_before
    assert _table_rows(connect, "decisions") == decisions_before
    assert len(_run_rows(connect)) == 2


@pytest.mark.db
def test_missing_official_result_upgrades_when_the_line_arrives(
    connect, clean_db
) -> None:
    _seed_base(connect)
    _seed_g2(connect, with_stat=False)

    run_grade(connect, invocation_id="gh-grade-6", now=NOW)
    grade = _grade_for(connect, "proj-g2")
    assert grade["status"] == "missing_official_result"
    assert grade["official_value"] is None
    assert grade["graded_stat_version"] is None
    assert _thresholds_for(connect, "proj-g2") == [], (
        "no official value, no threshold observations"
    )

    # Still no line: the revisit is comparison-driven and writes nothing.
    status = run_grade(connect, invocation_id="gh-grade-6b", now=NOW)
    assert status == "not_expected"
    assert _grade_for(connect, "proj-g2") == grade

    with connect() as conn, conn.cursor() as cur:
        _insert_stat(cur, "stat-g2", "g2", 64.0, NOW + timedelta(hours=3))
        conn.commit()

    status = run_grade(
        connect, invocation_id="gh-grade-6c", now=NOW + timedelta(hours=4)
    )
    assert status == "succeeded"
    upgraded = _grade_for(connect, "proj-g2")
    assert upgraded["status"] == "graded"
    assert float(upgraded["official_value"]) == pytest.approx(64.0)
    assert upgraded["graded_stat_version"] == 1
    assert len(_thresholds_for(connect, "proj-g2")) == len(
        stat_spec("receiving_yards").thresholds
    )


@pytest.mark.db
def test_cancelled_game_is_terminal(connect, clean_db) -> None:
    _seed_base(connect)
    with connect() as conn, conn.cursor() as cur:
        _insert_game(cur, "gc", 2025, 11,
                     KICKOFF_G2 + timedelta(days=7), "cancelled")
        _insert_projection(
            cur, "proj-gc", "gc", stat_type="receiving_yards",
            kind=KIND_ZIL, params=ZIL_PARAMS, pmf=None,
            cutoff=KICKOFF_G2 + timedelta(days=7) - timedelta(minutes=90),
            computed_at=KICKOFF_G2 + timedelta(days=6),
        )
        conn.commit()

    run_grade(connect, invocation_id="gh-grade-7", now=NOW + timedelta(days=8))
    grade = _grade_for(connect, "proj-gc")
    assert grade["status"] == "game_never_completed"
    assert grade["official_value"] is None
    assert _thresholds_for(connect, "proj-gc") == []

    # Terminal: the game is never reselected, so a later run is dormant.
    status = run_grade(
        connect, invocation_id="gh-grade-7b", now=NOW + timedelta(days=9)
    )
    assert status == "not_expected"
    assert _grade_for(connect, "proj-gc") == grade


@pytest.mark.db
def test_interrupted_run_leaves_no_partial_game(connect, clean_db, monkeypatch) -> None:
    _seed_base(connect)
    _seed_g2(connect)
    with connect() as conn, conn.cursor() as cur:
        # A second evaluative unit on g1 so the game has more than one write.
        nb = NegativeBinomial(r=4.0, p=0.5, cap=15)
        _insert_projection(
            cur, "proj-g1-rec", "g1", stat_type="receptions",
            kind=KIND_NB, params={"r": 4.0, "p": 0.5}, pmf=nb.pmf(),
            cutoff=CUTOFF_G1, computed_at=KICKOFF_G1 - timedelta(hours=2),
            projected_value=4.0, projected_median=4.0,
        )
        cur.execute(
            "update player_game_stats set receptions = 6, updated_at = now()"
            " where id = %s",
            (_uid("stat-g1"),),
        )
        conn.commit()

    import sightline_ingest.grade_job as gj

    real_write = gj._write_intent

    def failing_write(cur, intent, *, graded_at):
        # receiving_yards sorts (and writes) first; the second unit explodes,
        # which must roll back the whole game.
        if intent.projection_id == _uid("proj-g1-rec"):
            raise RuntimeError("disk fell over mid-game")
        return real_write(cur, intent, graded_at=graded_at)

    monkeypatch.setattr(gj, "_write_intent", failing_write)

    status = run_grade(connect, invocation_id="gh-grade-8", now=NOW)

    assert status == "failed"
    assert _grade_for(connect, "proj-g1") is None, (
        "a partial game must roll back entirely"
    )
    assert _grade_for(connect, "proj-g1-rec") is None
    assert _thresholds_for(connect, "proj-g1") == []
    # The healthy game still graded (per-game transaction boundary)...
    assert _grade_for(connect, "proj-g2")["status"] == "graded"
    # ...and the cycle records the truth per game.
    games = _game_rows(connect)
    assert games[_uid("g1")]["status"] == "failed"
    assert games[_uid("g2")]["status"] == "succeeded"
    (run,) = _run_rows(connect)
    assert run["status"] == "failed"

    # The interrupted game regrades cleanly on the next cycle.
    monkeypatch.setattr(gj, "_write_intent", real_write)
    status = run_grade(
        connect, invocation_id="gh-grade-8b", now=NOW + timedelta(hours=1)
    )
    assert status == "succeeded"
    assert _grade_for(connect, "proj-g1")["status"] == "graded"
    assert _grade_for(connect, "proj-g1-rec")["status"] == "graded"


@pytest.mark.db
def test_baselines_are_asof_the_projection_cutoff(connect, clean_db) -> None:
    """The adversarial baseline fixture: a 240-yard game whose stat line was
    published AFTER the projection's cutoff must not move the stored baseline
    errors. A hand-rolled aggregate over the current stats table would include
    it (season average 111.6 instead of 79.5) — and flatter nothing, but leak.
    """
    _seed_base(connect)
    with connect() as conn, conn.cursor() as cur:
        # A 9:30am-ET London game the same Sunday: kicks off BEFORE g1 (so it
        # is a prior game by kickoff order), but its line publishes 09:00 ET
        # the NEXT day — after g1's cutoff, per the corpus's publication rule.
        # Visible to the grading clock, invisible at the cutoff.
        late_kickoff = KICKOFF_G1 - timedelta(hours=3)
        _insert_game(cur, "game-late", 2025, 8, late_kickoff, "completed")
        _insert_stat(cur, "stat-late", "game-late", 240.0,
                     late_kickoff + timedelta(days=1))
        conn.commit()

    run_grade(connect, invocation_id="gh-grade-9", now=NOW)

    grade = _grade_for(connect, "proj-g1")
    assert grade["status"] == "graded"
    # |88 - 79.5| = 8.5 — the pre-cutoff season average. If the late game
    # leaked in, this would be |88 - 111.6| = 23.6.
    assert float(grade["season_avg_abs_error"]) == pytest.approx(8.5)
    assert float(grade["trailing_five_abs_error"]) == pytest.approx(12.4)
