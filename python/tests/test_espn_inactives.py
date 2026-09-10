"""ESPN inactives ingest (SIG-76): parsing, resolution, and honest failure.

The orchestration is tested with an injected ``fetch`` and the tiny simulation
fixture, so no network and no fitted-model artefacts on disk are required beyond
the synthetic ones the simulation suite already builds.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id as _game_id
from sightline_ingest.datasets._common import player_id as _player_id
from sightline_ingest.datasets.espn_inactives import (
    EspnInactivesError,
    RawInactive,
    map_game,
    parse_payload,
    resolve_player,
    run_espn_inactives,
)
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.identity_resolution import RESOLVED, NameIndex
from sightline_ingest.provenance import IngestRunHandle
from sightline_model.project_live import run_project
from sightline_model.simulation import live
from sightline_model.simulation.config import SIMULATION_MODEL_VERSION

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
_NOW = datetime(2023, 9, 10, 15, 30)


# --- pure parsing ----------------------------------------------------------


def test_parse_payload_reads_a_well_formed_list() -> None:
    payload = {
        "inactives": [
            {"playerName": "Ja'Marr Chase", "team": "CIN", "status": "Out", "espnId": "123"},
            {"name": "Tee Higgins", "abbreviation": "CIN", "designation": "Questionable"},
        ]
    }
    parsed = parse_payload(payload, now=_NOW)
    assert len(parsed) == 2
    assert parsed[0].team_abbr == "CIN" and parsed[0].status == "out"
    assert parsed[0].espn_player_id == "123"
    assert parsed[1].status == "questionable"


def test_parse_payload_raises_when_records_present_but_unparseable() -> None:
    # A changed schema (records with none of the known keys) must surface as a
    # failure, not a falsely-healthy empty run.
    with pytest.raises(EspnInactivesError):
        parse_payload({"inactives": [{"unexpected": "shape"}]}, now=_NOW)


def test_parse_payload_empty_is_empty_not_an_error() -> None:
    assert parse_payload({"inactives": []}, now=_NOW) == []
    assert parse_payload([], now=_NOW) == []


# --- DB-backed resolution + orchestration ----------------------------------


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
    return connect


def _subject_name(connect) -> str:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select full_name from players where id = %s", (_player_id(_SUBJECT),))
        return cur.fetchone()[0]


def _rows(connect, sql, params=()):
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(zip([d.name for d in cur.description], r)) for r in cur.fetchall()]


def test_map_game_finds_the_upcoming_game_for_a_team(env) -> None:
    with env() as conn, conn.cursor() as cur:
        game = map_game(cur, team_abbr="KC", now=_NOW)
    assert game is not None
    assert game["id"] == _game_id(_TARGET_GAME)
    assert game["home_abbr"] == "KC"


def test_resolve_player_matches_by_name(env) -> None:
    name = _subject_name(env)
    with env() as conn, conn.cursor() as cur:
        idx = NameIndex.from_players(
            [(r["id"], r["full_name"]) for r in _rows(env, "select id, full_name from players")]
        )
        res = resolve_player(cur, RawInactive(player_name=name, team_abbr="KC", status="out"), idx)
    assert res.status == RESOLVED and res.player_id == _player_id(_SUBJECT)


def _run(connect, models_dir, raws, *, now=_NOW):
    handle = IngestRunHandle(source="espn", dataset="espn_inactives")
    models = live.load_simulation_models(models_dir)
    run_espn_inactives(
        handle, connect, 2023, 2023, fetch=lambda *, now: list(raws), models=models, now=now
    )
    return handle


def test_out_report_produces_a_suggestion_via_the_engine(env, models_dir) -> None:
    raw = RawInactive(player_name=_subject_name(env), team_abbr="KC", status="out")
    handle = _run(env, models_dir, [raw])
    assert handle.rows_written >= 1

    sug = _rows(
        env,
        "select status::text as status from adjustment_suggestions where target_player_id = %s",
        (_player_id(_TEAMMATE),),
    )
    assert sug and sug[0]["status"] == "pending"


def test_republished_identical_report_creates_no_duplicate(env, models_dir) -> None:
    raw = RawInactive(player_name=_subject_name(env), team_abbr="KC", status="out")
    _run(env, models_dir, [raw])
    before = _rows(env, "select count(*)::int as n from adjustment_suggestions")[0]["n"]
    events_before = _rows(env, "select count(*)::int as n from adjustment_source_events")[0]["n"]
    _run(env, models_dir, [raw])  # same list again
    after = _rows(env, "select count(*)::int as n from adjustment_suggestions")[0]["n"]
    events_after = _rows(env, "select count(*)::int as n from adjustment_source_events")[0]["n"]
    assert after == before, "a re-published identical report must not duplicate suggestions"
    assert events_after == events_before, "a duplicate must not create a second source event"


def test_fetch_outage_raises_and_writes_nothing(env, models_dir) -> None:
    def _boom(*, now):
        raise EspnInactivesError("ESPN unreachable")

    handle = IngestRunHandle(source="espn", dataset="espn_inactives")
    models = live.load_simulation_models(models_dir)
    with pytest.raises(EspnInactivesError):
        run_espn_inactives(handle, env, 2023, 2023, fetch=_boom, models=models, now=_NOW)

    events = _rows(env, "select count(*)::int as n from adjustment_source_events")[0]["n"]
    assert events == 0, "an outage must leave no partial source events"


def test_unresolved_report_is_skipped_and_marked_partial(env, models_dir) -> None:
    raw = RawInactive(player_name="Nonexistent Player", team_abbr="KC", status="out")
    handle = _run(env, models_dir, [raw])
    assert handle.status == "partial"
    events = _rows(env, "select count(*)::int as n from adjustment_source_events")[0]["n"]
    assert events == 0, "an unresolved report must never be guessed onto a player"
