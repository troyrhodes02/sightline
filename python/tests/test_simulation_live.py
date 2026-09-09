"""Live production path for the Simulation Engine (SIG-71).

These tests attack the properties that make the ModelSelection-driven live path
trustworthy:

* **Routing.** A stat type whose ``model_selections`` row names the simulation
  engine is projected by the joint per-game engine and persisted as an empirical
  distribution attributed to ``simulation-mc-0.1.0``; a stat type left on the
  baseline still persists a baseline projection attributed to
  ``baseline-zil-0.1.0`` from the SAME run — the two engines coexist per game.
* **Full persistence.** One simulated game/cutoff writes ``projections`` +
  ``projection_drivers``, a ``game_simulations`` metadata row, its
  ``player_outcome_correlations``, and ``projection_declines`` for any
  insufficient-evidence player.
* **Idempotence.** Re-running at the same cutoff inserts nothing and changes
  nothing (deterministic ids on the compound unique keys).

The corpus reuses the tiny backtest fixture (one matchup, a handful of players);
here contracts + a ModelSelection routing are layered on top.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from sightline_ingest.datasets._common import game_id as _game_id
from sightline_ingest.datasets._common import player_id as _player_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_model.project_live import run_project
from sightline_model.simulation import live
from sightline_model.simulation.config import SIMULATION_MODEL_VERSION

# Reuse the backtest fixture's data + synthetic model builders verbatim: the
# corpus that makes every player projectable there makes them projectable here.
# Imported by bare module name — pytest's default (prepend) import mode puts the
# tests directory on sys.path, so the sibling module resolves without a package.
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

BASELINE_MODEL_VERSION = "baseline-zil-0.1.0"

# Project the FIRST upcoming game (2023 week 1). Cutoff a day before kickoff so
# every prior game is published and the game itself is still upcoming.
_TARGET_GAME = GAMES[0]  # 2023_01_DET_KC
_KICKOFF = datetime(2023, 9, 10, 17, 0)
_CUTOFF = datetime(2023, 9, 9, 12, 0)

# One simulation-routed stat and one baseline-routed stat, both with contracts.
_SIM_STAT = "receiving_yards"
_BASELINE_STAT = "rushing_yards"

_CONTRACT_PLAYERS = {
    _SIM_STAT: ["00-0031000", "00-0032000", "00-0034000"],  # two KC WRs + DET WR
    _BASELINE_STAT: ["00-0033000"],  # the KC RB
}


@pytest.fixture
def models_dir(tmp_path):
    """Stage the three synthetic fitted models to disk and point the loader at it."""
    base = tmp_path / "sim-models"
    base.mkdir(parents=True, exist_ok=True)
    models = _models()
    models.game_environment.save(base / "game_environment.joblib")
    models.usage.save(base / "usage_allocation.joblib")
    models.efficiency.save(base / "efficiency.joblib")
    return base


@pytest.fixture
def corpus(connect, clean_db, monkeypatch, models_dir):
    """The backtest fixture corpus + contracts + a simulation ModelSelection."""
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2022, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2022, 2023, fetch=lambda s: _stats_df())

    # The target game must be SCHEDULED and in the future relative to the run's
    # "now"; the fixture ingested it as a played game, so re-stamp it upcoming.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update games set status = 'scheduled'::\"GameStatus\", kickoff_at = %s"
            " where id = %s",
            (_KICKOFF, _game_id(_TARGET_GAME)),
        )
        _insert_contracts(cur)
        # The migration seeds model_selections, but the full suite may have
        # truncated it; upsert every stat to the baseline so the registry is
        # known-good regardless of prior tests, then route the simulation stat.
        _seed_model_selections(cur)
        cur.execute(
            "update model_selections set model_version = %s where stat_type = %s::\"StatType\"",
            (SIMULATION_MODEL_VERSION, _SIM_STAT),
        )
        conn.commit()

    monkeypatch.setenv("SIGHTLINE_SIM_MODELS_DIR", str(models_dir))
    # run_project uses the module-level direct-connection factory; point it at the
    # TEST database (the same factory the fixtures write through) so the run reads
    # and writes the fixture corpus, never the dev database.
    monkeypatch.setattr("sightline_model.project_live.connect", connect)
    return connect


_ALL_STAT_TYPES = (
    "passing_yards", "rushing_yards", "receiving_yards",
    "receptions", "rushing_tds", "receiving_tds",
)


def _seed_model_selections(cur) -> None:
    """Upsert all six stat types onto the baseline (the migration's seed shape)."""
    for stat_type in _ALL_STAT_TYPES:
        cur.execute(
            "insert into model_selections (stat_type, model_version, promoted_at, updated_at)"
            " values (%s::\"StatType\", %s, now(), now())"
            " on conflict (stat_type) do update set model_version = excluded.model_version,"
            " backtest_run_id = null, brier_delta = null, sample_size = null, note = null",
            (stat_type, BASELINE_MODEL_VERSION),
        )


def _insert_contracts(cur) -> None:
    ns = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    for stat_type, players in _CONTRACT_PLAYERS.items():
        for gsis in players:
            cid = str(uuid.uuid5(ns, f"live-contract:{stat_type}:{gsis}"))
            cur.execute(
                "insert into contracts (id, kalshi_ticker, title, kalshi_player_name,"
                " player_id, game_id, stat_type, threshold, resolution_status, status,"
                " first_seen_at, last_seen_at, created_at, updated_at)"
                " values (%s,%s,%s,%s,%s,%s,%s::\"StatType\",%s,"
                " 'resolved'::\"IdentityResolutionStatus\", 'active'::\"ContractStatus\","
                " now(), now(), now(), now())",
                (cid, f"KX-{stat_type}-{gsis}", f"{gsis} {stat_type}", gsis,
                 _player_id(gsis), _game_id(_TARGET_GAME), stat_type, 50.5),
            )


def _now() -> datetime:
    # A "now" after the cutoff but before kickoff, so the upcoming game is
    # selected as a candidate.
    return datetime(2023, 9, 9, 13, 0)


def _rows(connect, sql: str, params: tuple = ()) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Routing + persistence
# ---------------------------------------------------------------------------


def test_simulation_routed_stat_persists_all_simulation_outputs(corpus) -> None:
    run_project(_CUTOFF.replace(tzinfo=timezone.utc), now=_now())

    # Projections for the simulation stat carry the simulation model version and
    # an empirical distribution kind.
    sim_projections = _rows(
        corpus,
        "select player_id, distribution_kind, model_version, quantiles, pmf"
        " from projections where stat_type = %s::\"StatType\""
        " and model_version = %s",
        (_SIM_STAT, SIMULATION_MODEL_VERSION),
    )
    assert sim_projections, "no simulation projection persisted for the routed stat"
    for row in sim_projections:
        assert row["distribution_kind"] in ("empirical_quantiles", "empirical_pmf")
        # receiving_yards is continuous -> quantile grid, no PMF.
        assert row["quantiles"] is not None
        assert row["pmf"] is None

    # Drivers landed for each simulation projection.
    driver_count = _rows(
        corpus,
        "select count(*) as n from projection_drivers d"
        " join projections p on p.id = d.projection_id"
        " where p.model_version = %s",
        (SIMULATION_MODEL_VERSION,),
    )[0]["n"]
    assert driver_count > 0

    # Exactly one game_simulations metadata row for the game/cutoff, with a
    # real seed and the versioned draw count.
    game_sims = _rows(
        corpus,
        "select id, seed, draw_count, model_version from game_simulations"
        " where game_id = %s",
        (_game_id(_TARGET_GAME),),
    )
    assert len(game_sims) == 1
    assert game_sims[0]["model_version"] == SIMULATION_MODEL_VERSION
    assert game_sims[0]["draw_count"] == 5000
    assert game_sims[0]["seed"] >= 0

    # Correlations among the projected marginals (at least the two KC WRs, both
    # receiving) are stored, each a real number in [-1, 1].
    correlations = _rows(
        corpus,
        "select correlation, method from player_outcome_correlations"
        " where game_simulation_id = %s",
        (game_sims[0]["id"],),
    )
    assert correlations, "no joint-outcome correlations persisted"
    for row in correlations:
        assert row["method"] == "spearman"
        assert -1.0 <= float(row["correlation"]) <= 1.0


def test_baseline_routed_stat_coexists_with_simulation(corpus) -> None:
    run_project(_CUTOFF.replace(tzinfo=timezone.utc), now=_now())

    # The baseline-routed stat is persisted under the BASELINE version, from the
    # same run — the two engines coexist per game.
    baseline = _rows(
        corpus,
        "select model_version, distribution_kind from projections"
        " where stat_type = %s::\"StatType\"",
        (_BASELINE_STAT,),
    )
    assert baseline, "no projection persisted for the baseline-routed stat"
    assert {r["model_version"] for r in baseline} == {BASELINE_MODEL_VERSION}
    # The baseline stat never produced an empirical (simulation) distribution.
    assert all(
        r["distribution_kind"] not in ("empirical_quantiles", "empirical_pmf")
        for r in baseline
    )

    # And the simulation stat never produced a baseline-version projection.
    sim_versions = {
        r["model_version"]
        for r in _rows(
            corpus,
            "select distinct model_version from projections"
            " where stat_type = %s::\"StatType\"",
            (_SIM_STAT,),
        )
    }
    assert sim_versions == {SIMULATION_MODEL_VERSION}


def test_reruns_are_idempotent(corpus) -> None:
    cutoff = _CUTOFF.replace(tzinfo=timezone.utc)
    run_project(cutoff, now=_now())

    def snapshot() -> dict[str, int]:
        return {
            table: _rows(corpus, f"select count(*) as n from {table}")[0]["n"]
            for table in (
                "projections",
                "projection_drivers",
                "game_simulations",
                "player_outcome_correlations",
                "projection_declines",
            )
        }

    first = snapshot()
    # A re-run at the same cutoff writes nothing new.
    run_project(cutoff, now=_now())
    second = snapshot()
    assert first == second, f"re-run was not idempotent: {first} -> {second}"

    # The stored simulation distribution is byte-identical across runs (seeded).
    dist = _rows(
        corpus,
        "select quantiles from projections where model_version = %s order by id",
        (SIMULATION_MODEL_VERSION,),
    )
    run_project(cutoff, now=_now())
    dist_again = _rows(
        corpus,
        "select quantiles from projections where model_version = %s order by id",
        (SIMULATION_MODEL_VERSION,),
    )
    assert dist == dist_again


# ---------------------------------------------------------------------------
# Decline path (insufficient evidence)
# ---------------------------------------------------------------------------


def test_insufficient_evidence_player_writes_a_decline(corpus) -> None:
    # A brand-new player with a contract on the simulation stat but ZERO prior
    # history is declined (insufficient_evidence), not fabricated.
    ns = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    rookie = "00-0099999"
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into players (id, full_name, position, created_at, updated_at)"
            " values (%s,%s,'WR',now(),now())",
            (_player_id(rookie), "Rookie Receiver"),
        )
        cid = str(uuid.uuid5(ns, f"live-contract:rookie:{rookie}"))
        cur.execute(
            "insert into contracts (id, kalshi_ticker, title, kalshi_player_name,"
            " player_id, game_id, stat_type, threshold, resolution_status, status,"
            " first_seen_at, last_seen_at, created_at, updated_at)"
            " values (%s,%s,%s,%s,%s,%s,%s::\"StatType\",%s,"
            " 'resolved'::\"IdentityResolutionStatus\", 'active'::\"ContractStatus\","
            " now(), now(), now(), now())",
            (cid, f"KX-rookie-{rookie}", "rookie", rookie,
             _player_id(rookie), _game_id(_TARGET_GAME), _SIM_STAT, 50.5),
        )
        conn.commit()

    run_project(_CUTOFF.replace(tzinfo=timezone.utc), now=_now())

    declines = _rows(
        corpus,
        "select player_id, reason, model_version from projection_declines"
        " where player_id = %s",
        (_player_id(rookie),),
    )
    assert len(declines) == 1
    assert declines[0]["reason"] == "insufficient_evidence"
    assert declines[0]["model_version"] == SIMULATION_MODEL_VERSION
    # No projection was fabricated for the declined player.
    assert not _rows(
        corpus,
        "select 1 from projections where player_id = %s",
        (_player_id(rookie),),
    )
