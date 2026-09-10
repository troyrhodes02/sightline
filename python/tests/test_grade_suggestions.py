"""Grading extensions for Adjustment Suggestions (SIG-77).

Attacks the properties the reliability numbers rest on:

* Declining (or never touching) a suggestion still results in a graded shadow at
  outcome time — grading is never confounded by William's choice.
* An accepted suggestion's BASE projection remains separately queryable and
  gradable after acceptance; base and shadow carry distinct grade rows.
* The source claim is graded against official participation (snaps, or their
  absence), never Kalshi settlement, and re-grading is idempotent.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id as _game_id
from sightline_ingest.datasets._common import player_id as _player_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.grade_job import run_grade
from sightline_model.project_live import run_project
from sightline_model.simulation import live
from sightline_model.suggestions.engine import Observation, process_observation

from test_simulation_backtest import (  # noqa: E402
    GAMES,
    _h,
    _models,
    _players_df,
    _schedule_df,
    _stats_df,
    _teams_df,
)
from test_suggestion_engine import (  # noqa: E402
    _CONTRACT_PLAYERS,
    _SIM_STAT,
    _SUBJECT,
    _TEAMMATE,
    _insert_contracts,
    _seed_model_selections,
)

pytestmark = pytest.mark.db

_TARGET_GAME = GAMES[0]
_KICKOFF = datetime(2023, 9, 10, 17, 0)
_KNOWN_AT = datetime(2023, 9, 10, 15, 30)
_INGEST = "grade-test-run"


@pytest.fixture
def models_dir(tmp_path):
    base = tmp_path / "sim-models"
    base.mkdir(parents=True, exist_ok=True)
    models = _models()
    models.game_environment.save(base / "game_environment.joblib")
    models.usage.save(base / "usage_allocation.joblib")
    models.efficiency.save(base / "efficiency.joblib")
    return base


def _rows(connect, sql, params=()):
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(zip([d.name for d in cur.description], r)) for r in cur.fetchall()]


def _insert_actual(cur, gsis, receiving_yards):
    """A final official stat line for the target game."""
    cur.execute(
        "insert into player_game_stats (id, player_id, game_id, team_abbr_at_game,"
        " receiving_yards, version, valid_at, known_at, known_at_reconstructed,"
        " source, ingest_run_id, created_at, updated_at)"
        " values (%s,%s,%s,%s,%s,1,%s,%s,true,'nflverse'::\"DataSource\",%s,now(),now())"
        " on conflict (player_id, game_id) do update set"
        " receiving_yards = excluded.receiving_yards, version = player_game_stats.version + 1,"
        " updated_at = now()",
        (str(uuid.uuid4()), _player_id(gsis), _game_id(_TARGET_GAME), "KC",
         receiving_yards, _KICKOFF, _KICKOFF, _INGEST),
    )


def _insert_snaps(cur, gsis, snaps):
    cur.execute(
        "insert into player_game_context (id, player_id, game_id, team_abbr_at_game,"
        " context_type, numeric_value, valid_at, known_at, known_at_reconstructed,"
        " source, ingest_run_id, created_at)"
        " values (%s,%s,%s,%s,'snap_count_offense'::\"ContextType\",%s,%s,%s,true,"
        " 'nflverse'::\"DataSource\",%s,now())"
        " on conflict (player_id, game_id, context_type, known_at, source) do nothing",
        (str(uuid.uuid4()), _player_id(gsis), _game_id(_TARGET_GAME), "KC",
         snaps, _KICKOFF, _KICKOFF, _INGEST),
    )


@pytest.fixture
def graded_world(connect, clean_db, monkeypatch, models_dir):
    """Base + shadow projections, then a completed game with actuals + snaps."""
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2022, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2022, 2023, fetch=lambda s: _stats_df())
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update games set status = 'scheduled'::\"GameStatus\", kickoff_at = %s where id = %s",
            (_KICKOFF, _game_id(_TARGET_GAME)),
        )
        _insert_contracts(cur, _CONTRACT_PLAYERS)
        _seed_model_selections(cur)
        conn.commit()
    monkeypatch.setenv("SIGHTLINE_SIM_MODELS_DIR", str(models_dir))
    monkeypatch.setattr("sightline_model.project_live.connect", connect)
    run_project(datetime(2023, 9, 9, 12, 0, tzinfo=timezone.utc), now=datetime(2023, 9, 9, 13, 0))

    # Raise a suggestion (pending) → creates the shadow for the teammate.
    models = live.load_simulation_models(models_dir)
    obs = Observation(
        source="espn", subject_player_id=_player_id(_SUBJECT),
        game_id=_game_id(_TARGET_GAME), claim_type="game_status", claim_value="out",
        evidence_text="ESPN inactives: listed OUT", known_at=_KNOWN_AT,
        ingest_run_id=_INGEST,
    )
    with connect() as conn:
        process_observation(
            conn, lambda c: AsOfCorpus(connect, c), observation=obs,
            game={"id": _game_id(_TARGET_GAME), "season": 2023, "home_abbr": "KC",
                  "away_abbr": "DET", "is_dome": False, "kickoff_at": _KICKOFF},
            models=models, now=datetime(2023, 9, 10, 15, 31), draw_count=2000,
        )
        conn.commit()

    # Complete the game: the teammate played (snaps + a real line), the subject
    # sat (no snaps, no line) — so the "out" claim proved correct.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update games set status = 'completed'::\"GameStatus\" where id = %s",
            (_game_id(_TARGET_GAME),),
        )
        _insert_actual(cur, _TEAMMATE, 82.0)
        _insert_snaps(cur, _TEAMMATE, 55)
        conn.commit()
    return connect


def test_declined_suggestion_still_grades_the_shadow(graded_world) -> None:
    connect = graded_world
    # The suggestion is pending (never accepted); make it declined to be explicit.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update adjustment_suggestions set status = 'declined'::\"SuggestionStatus\""
            " where target_player_id = %s",
            (_player_id(_TEAMMATE),),
        )
        conn.commit()

    run_grade(connect, invocation_id="grade-1", now=datetime(2023, 9, 11, 9, 0))

    graded = _rows(
        connect,
        "select pg.id from projection_grades pg join projections p on p.id = pg.projection_id"
        " where p.provenance = 'adjustment_shadow'::\"ProjectionProvenance\""
        " and p.player_id = %s and pg.status = 'graded'::\"ProjectionGradeStatus\"",
        (_player_id(_TEAMMATE),),
    )
    assert graded, "a declined suggestion's shadow must still be graded at outcome time"


def test_accepted_suggestion_keeps_base_separately_gradable(graded_world) -> None:
    connect = graded_world
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update adjustment_suggestions set status = 'accepted'::\"SuggestionStatus\""
            " where target_player_id = %s",
            (_player_id(_TEAMMATE),),
        )
        conn.commit()

    run_grade(connect, invocation_id="grade-2", now=datetime(2023, 9, 11, 9, 0))

    grades = _rows(
        connect,
        "select p.provenance::text as provenance, pg.status::text as status,"
        " pg.official_value from projection_grades pg"
        " join projections p on p.id = pg.projection_id"
        " where p.player_id = %s and p.stat_type = %s::\"StatType\"",
        (_player_id(_TEAMMATE), _SIM_STAT),
    )
    provenances = {g["provenance"] for g in grades}
    assert "base" in provenances, "the base projection must remain gradable after acceptance"
    assert "adjustment_shadow" in provenances, "the shadow must also be graded"
    # Distinct rows, both graded against the same official line.
    assert all(g["status"] == "graded" for g in grades)
    assert len({(g["provenance"]) for g in grades}) == 2


def test_source_claim_graded_against_participation(graded_world) -> None:
    connect = graded_world
    run_grade(connect, invocation_id="grade-3", now=datetime(2023, 9, 11, 9, 0))

    event = _rows(
        connect,
        "select source_outcome::text as outcome from adjustment_source_events"
        " where subject_player_id = %s",
        (_player_id(_SUBJECT),),
    )
    # Subject was reported OUT and recorded no snaps → the claim was correct.
    assert event and event[0]["outcome"] == "correct"


def test_regrade_is_idempotent(graded_world) -> None:
    connect = graded_world
    run_grade(connect, invocation_id="grade-4a", now=datetime(2023, 9, 11, 9, 0))
    before = _rows(
        connect,
        "select projection_id, updated_at from projection_grades order by projection_id",
    )
    # A second run over unchanged data must write nothing (comparison-driven).
    status = run_grade(connect, invocation_id="grade-4b", now=datetime(2023, 9, 12, 9, 0))
    after = _rows(
        connect,
        "select projection_id, updated_at from projection_grades order by projection_id",
    )
    assert status in ("succeeded", "not_expected")
    assert before == after, "an unchanged re-grade must not rewrite grade rows"
