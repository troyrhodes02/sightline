"""Adjustment Suggestions engine end to end (SIG-75).

Uses the tiny backtest/simulation fixture (one matchup, a handful of players) to
attack the properties the feature rests on:

* A shadow-adjusted projection is a REAL, persisted projection with
  provenance='adjustment_shadow', computed with the subject forced unavailable —
  and the base projection it is compared against is preserved untouched.
* Point-in-time discipline: the shadow's information_cutoff is exactly the
  source claim's known_at, and re-running is byte-identical (a projection for a
  game is the same whether computed then or now).
* A claim arriving AFTER kickoff is retained but raises no shadow and never edits
  the frozen pre-game record — using the kickoff timestamp as the boundary.
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
from sightline_model.project_live import run_project
from sightline_model.simulation import live
from sightline_model.simulation.config import SIMULATION_MODEL_VERSION
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

pytestmark = pytest.mark.db

_TARGET_GAME = GAMES[0]  # 2023_01_DET_KC → away DET, home KC
_KICKOFF = datetime(2023, 9, 10, 17, 0)
_BASE_CUTOFF = datetime(2023, 9, 9, 12, 0)
_KNOWN_AT = datetime(2023, 9, 10, 15, 30)  # 90 min pre-kickoff, after the base cutoff

_SIM_STAT = "receiving_yards"
_SUBJECT = "00-0031000"  # a KC WR who sits
_TEAMMATE = "00-0032000"  # another KC WR who inherits usage
_DET_WR = "00-0034000"
_CONTRACT_PLAYERS = [_SUBJECT, _TEAMMATE, _DET_WR]

_ALL_STAT_TYPES = (
    "passing_yards", "rushing_yards", "receiving_yards",
    "receptions", "rushing_tds", "receiving_tds",
)


def _game_dict() -> dict:
    return {
        "id": _game_id(_TARGET_GAME),
        "season": 2023,
        "home_abbr": "KC",
        "away_abbr": "DET",
        "is_dome": False,
        "kickoff_at": _KICKOFF,
    }


def _seed_model_selections(cur) -> None:
    for stat_type in _ALL_STAT_TYPES:
        cur.execute(
            "insert into model_selections (stat_type, model_version, promoted_at, updated_at)"
            " values (%s::\"StatType\", %s, now(), now())"
            " on conflict (stat_type) do update set model_version = excluded.model_version,"
            " backtest_run_id = null, brier_delta = null, sample_size = null, note = null",
            (stat_type, "baseline-zil-0.1.0"),
        )
    cur.execute(
        "update model_selections set model_version = %s where stat_type = %s::\"StatType\"",
        (SIMULATION_MODEL_VERSION, _SIM_STAT),
    )


def _insert_contracts(cur, players: list[str]) -> None:
    ns = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    for gsis in players:
        cid = str(uuid.uuid5(ns, f"sug-contract:{_SIM_STAT}:{gsis}"))
        cur.execute(
            "insert into contracts (id, kalshi_ticker, title, kalshi_player_name,"
            " player_id, game_id, stat_type, threshold, resolution_status, status,"
            " first_seen_at, last_seen_at, created_at, updated_at)"
            " values (%s,%s,%s,%s,%s,%s,%s::\"StatType\",%s,"
            " 'resolved'::\"IdentityResolutionStatus\", 'active'::\"ContractStatus\","
            " now(), now(), now(), now()) on conflict (kalshi_ticker) do nothing",
            (cid, f"KX-{_SIM_STAT}-{gsis}", f"{gsis} {_SIM_STAT}", gsis,
             _player_id(gsis), _game_id(_TARGET_GAME), _SIM_STAT, 50.5),
        )


@pytest.fixture
def models_dir(tmp_path):
    base = tmp_path / "sim-models"
    base.mkdir(parents=True, exist_ok=True)
    models = _models()
    models.game_environment.save(base / "game_environment.joblib")
    models.usage.save(base / "usage_allocation.joblib")
    models.efficiency.save(base / "efficiency.joblib")
    return base


@pytest.fixture
def env(connect, clean_db, monkeypatch, models_dir):
    """Ingest the fixture, list contracts, and compute base projections."""
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
    # Base projections for the listed players.
    run_project(_BASE_CUTOFF.replace(tzinfo=timezone.utc), now=datetime(2023, 9, 9, 13, 0))
    return connect


def _rows(connect, sql, params=()):
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _process(connect, models_dir, *, known_at):
    models = live.load_simulation_models(models_dir)
    factory = lambda cutoff: AsOfCorpus(connect, cutoff)  # noqa: E731
    obs = Observation(
        source="espn",
        subject_player_id=_player_id(_SUBJECT),
        game_id=_game_id(_TARGET_GAME),
        claim_type="game_status",
        claim_value="out",
        evidence_text="ESPN inactives: listed OUT",
        known_at=known_at,
        ingest_run_id="test-run",
    )
    with connect() as conn:
        result = process_observation(
            conn,
            factory,
            observation=obs,
            game=_game_dict(),
            models=models,
            now=datetime(2023, 9, 10, 15, 31),
            draw_count=2000,
        )
        conn.commit()
    return result


def test_out_claim_raises_a_shadow_and_pending_suggestion(env, models_dir) -> None:
    result = _process(env, models_dir, known_at=_KNOWN_AT)
    assert result.action == "create_new"
    assert result.suggestions_created >= 1

    # A shadow projection exists for the inheriting teammate, provenance shadow,
    # cutoff == the claim's known_at, and linked to its suggestion.
    shadows = _rows(
        env,
        "select p.player_id, p.provenance::text as provenance, p.information_cutoff,"
        " p.adjustment_suggestion_id, p.projected_value"
        " from projections p where p.provenance = 'adjustment_shadow'::\"ProjectionProvenance\""
        " and p.player_id = %s and p.stat_type = %s::\"StatType\"",
        (_player_id(_TEAMMATE), _SIM_STAT),
    )
    assert shadows, "no shadow projection persisted for the inheriting teammate"
    assert shadows[0]["information_cutoff"] == _KNOWN_AT
    assert shadows[0]["adjustment_suggestion_id"] is not None

    # The base projection is preserved, untouched, and separately queryable.
    # Parallel evaluation (SIG-103) stores BOTH engines' base projections for
    # the stat. The suggestion adjusts the ACTIVE model's projection (the one the
    # slate shows) — here receiving_yards is active on the simulation engine —
    # so the link targets the simulation base projection, not the baseline shadow.
    base = _rows(
        env,
        "select id, provenance::text as provenance from projections"
        " where player_id = %s and stat_type = %s::\"StatType\""
        " and provenance = 'base'::\"ProjectionProvenance\""
        " and model_version = %s",
        (_player_id(_TEAMMATE), _SIM_STAT, SIMULATION_MODEL_VERSION),
    )
    assert base, "active-model base projection must remain queryable after a shadow exists"
    assert len(base) == 1, "one active-model base projection per (player, game, stat)"

    # The baseline shadow base projection also exists (both engines run), but it
    # is NOT what the suggestion adjusts.
    all_base = _rows(
        env,
        "select model_version from projections"
        " where player_id = %s and stat_type = %s::\"StatType\""
        " and provenance = 'base'::\"ProjectionProvenance\"",
        (_player_id(_TEAMMATE), _SIM_STAT),
    )
    assert {r["model_version"] for r in all_base} == {
        SIMULATION_MODEL_VERSION,
        "baseline-zil-0.1.0",
    }, "both engines' base projections must be stored"

    # A pending suggestion links base and shadow with a human-readable reason.
    sug = _rows(
        env,
        "select status::text as status, reason_text, base_projection_id,"
        " shadow_projection_id from adjustment_suggestions"
        " where target_player_id = %s and stat_type = %s::\"StatType\"",
        (_player_id(_TEAMMATE), _SIM_STAT),
    )
    assert sug and sug[0]["status"] == "pending"
    assert sug[0]["shadow_projection_id"] is not None
    assert sug[0]["base_projection_id"] == base[0]["id"]
    assert len(sug[0]["reason_text"]) > 0


def test_shadow_is_byte_identical_on_rerun(env, models_dir) -> None:
    # A projection for a game is the same whether computed then or now: re-running
    # the engine at the same cutoff inserts nothing and changes nothing.
    _process(env, models_dir, known_at=_KNOWN_AT)
    first = _rows(
        env,
        "select id, quantiles, projected_value from projections"
        " where provenance = 'adjustment_shadow'::\"ProjectionProvenance\""
        " order by id",
    )
    _process(env, models_dir, known_at=_KNOWN_AT)
    second = _rows(
        env,
        "select id, quantiles, projected_value from projections"
        " where provenance = 'adjustment_shadow'::\"ProjectionProvenance\""
        " order by id",
    )
    assert first == second and len(first) >= 1


def test_claim_after_kickoff_raises_no_shadow_and_freezes_the_record(env, models_dir) -> None:
    after_kickoff = datetime(2023, 9, 10, 17, 30)  # 30 min AFTER kickoff
    result = _process(env, models_dir, known_at=after_kickoff)
    assert result.action == "post_kickoff"
    assert result.suggestions_created == 0

    event = _rows(
        env,
        "select status::text as status from adjustment_source_events"
        " where subject_player_id = %s",
        (_player_id(_SUBJECT),),
    )
    assert event and event[0]["status"] == "post_kickoff"

    shadows = _rows(
        env,
        "select id from projections where provenance = 'adjustment_shadow'::\"ProjectionProvenance\"",
    )
    assert shadows == [], "a post-kickoff claim must never persist a shadow"
