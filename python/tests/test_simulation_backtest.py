"""Simulation-Engine backtest integration (SIG-70).

The Simulation Engine plugs into the SAME chronological harness the baseline
uses; these tests prove the properties that make that integration trustworthy:

* a run stores the simulation model identity (``model_version``, non-zero
  ``seed``, ``rng_draws = 5000``), calibration bins, and per-layer validation
  blocks (RD-8);
* R5 reproducibility — the run reproduces all three digests over an unchanged
  fixture corpus;
* the promotion bar (RD-1) is a tested pure function, and the per-stat
  Brier-vs-baseline comparison reads from stored aggregates;
* model-version attribution — promoting one stat type does not alter another
  stat type's historical baseline projection attribution;
* point-in-time discipline — a fact planted AFTER the cutoff does not change a
  simulation prediction.

The corpus is a tiny fixture (one matchup, a handful of players, a few games),
NOT a real multi-season run.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle
from sightline_model import artifacts as art
from sightline_model import persist
from sightline_model.harness import RunConfig
from sightline_model.metrics import (
    compare_stat_type_briers,
    meets_promotion_bar,
)
from sightline_model.priors import Prior
from sightline_model.simulation import backtest as sim
from sightline_model.simulation.config import (
    DRAW_COUNT,
    SIMULATION_MODEL_VERSION,
)
from sightline_model.simulation.efficiency import (
    EFFICIENCY_KEYS,
    EfficiencyModel,
)
from sightline_model.simulation.game_environment import (
    FEATURE_COLUMNS as ENV_FEATURES,
    GameEnvironmentModel,
    TARGET_COLUMNS as ENV_TARGETS,
)
from sightline_model.simulation.usage_allocation import (
    FEATURE_COLUMNS as USAGE_FEATURES,
    LABEL_COLUMNS as USAGE_LABELS,
    UsageAllocationModel,
)

pytestmark = pytest.mark.db

# Two teams, a QB + two WRs + a RB per the offense we care about. Prior-season
# history gives every player a trailing sample (n_eff >= 1) so nobody declines.
PLAYERS = [
    ("00-0030000", "Pat Passer", "QB", "KC"),
    ("00-0031000", "Rashee Receiver", "WR", "KC"),
    ("00-0032000", "Wes Wideout", "WR", "KC"),
    ("00-0033000", "Ron Runner", "RB", "KC"),
    ("00-0034000", "Deon Defender", "WR", "DET"),
]
GAMES = [f"2023_{w:02d}_DET_KC" for w in range(1, 5)]
GAMEDAYS = ["2023-09-10", "2023-09-17", "2023-09-24", "2023-10-01"]
PRIOR_GAMES = [f"2022_{w:02d}_DET_KC" for w in range(1, 4)]
PRIOR_GAMEDAYS = ["2022-09-11", "2022-09-18", "2022-09-25"]
STAT_TYPES = ("receiving_yards", "rushing_yards", "receptions")


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["KC", "DET"],
        "team_conf": ["AFC", "NFC"], "team_division": ["W", "N"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [p[0] for p in PLAYERS],
        "display_name": [p[1] for p in PLAYERS],
        "position": [p[2] for p in PLAYERS],
        "birth_date": ["1996-01-01"] * len(PLAYERS),
        "pfr_id": [f"Pfr{i:05d}" for i in range(len(PLAYERS))],
    })


def _schedule_df() -> pl.DataFrame:
    ids = PRIOR_GAMES + GAMES
    days = PRIOR_GAMEDAYS + GAMEDAYS
    seasons = [2022] * len(PRIOR_GAMES) + [2023] * len(GAMES)
    weeks = list(range(1, len(PRIOR_GAMES) + 1)) + list(range(1, len(GAMES) + 1))
    n = len(ids)
    return pl.DataFrame({
        "game_id": ids, "season": seasons, "week": weeks,
        "game_type": ["REG"] * n, "gameday": days, "gametime": ["17:00"] * n,
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": ["outdoors"] * n,
        "stadium": ["Arrowhead"] * n, "location": ["Home"] * n, "result": [3] * n,
    })


def _stat_row(gsis, gid, team, **kw):
    row = {
        "player_id": gsis, "game_id": gid, "team": team,
        "passing_yards": None, "passing_tds": None, "attempts": None,
        "completions": None, "passing_interceptions": None,
        "rushing_yards": None, "rushing_tds": None, "carries": None,
        "receiving_yards": None, "receiving_tds": None,
        "receptions": None, "targets": None,
    }
    row.update(kw)
    return row


def _stats_df() -> pl.DataFrame:
    rows: list[dict] = []
    all_games = list(zip(PRIOR_GAMES + GAMES, [2022] * 3 + [2023] * 4))
    for i, (gid, _season) in enumerate(all_games):
        # QB: passes every game.
        rows.append(_stat_row(
            "00-0030000", gid, "KC",
            passing_yards=250.0 + 5 * i, passing_tds=2, attempts=32, completions=22,
        ))
        # WR1: the primary target.
        rows.append(_stat_row(
            "00-0031000", gid, "KC",
            receiving_yards=70.0 + 6 * i, receiving_tds=1, receptions=6, targets=9,
        ))
        # WR2: secondary.
        rows.append(_stat_row(
            "00-0032000", gid, "KC",
            receiving_yards=35.0 + 3 * i, receiving_tds=0, receptions=3, targets=5,
        ))
        # RB: carries plus a few targets.
        rows.append(_stat_row(
            "00-0033000", gid, "KC",
            rushing_yards=60.0 + 4 * i, rushing_tds=1, carries=15,
            receiving_yards=15.0, receiving_tds=0, receptions=2, targets=3,
        ))
        # DET WR (opponent), so both teams have participants.
        rows.append(_stat_row(
            "00-0034000", gid, "DET",
            receiving_yards=45.0 + 2 * i, receiving_tds=0, receptions=4, targets=7,
        ))
    return pl.DataFrame(rows)


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2022, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2022, 2023, fetch=lambda s: _stats_df())
    return connect


@pytest.fixture
def artifact_base(tmp_path):
    return tmp_path / "artifacts"


# --- Synthetic (pre-fit) layer models ---------------------------------------


def _env_model() -> GameEnvironmentModel:
    # A tiny synthetic training frame: attempts scale mildly with trailing plays.
    n = 40
    rows = []
    for i in range(n):
        rows.append({
            **{c: float(30 + (i % 7)) for c in ENV_FEATURES},
            "pass_attempts": 32.0 + (i % 5),
            "rush_attempts": 26.0 + (i % 4),
        })
    return GameEnvironmentModel().fit(pl.DataFrame(rows))


def _usage_model() -> UsageAllocationModel:
    n = 40
    rows = []
    for i in range(n):
        rows.append({
            "trailing_target_share": 0.05 + 0.02 * (i % 5),
            "trailing_carry_share": 0.02 * (i % 4),
            "trailing_snap_proxy": 0.3 + 0.05 * (i % 5),
            "position_code": float(1 + (i % 5)),
            "is_available": 1.0,
            "observed_target_share": 0.10 + 0.03 * (i % 5),
            "observed_carry_share": 0.05 * (i % 4),
        })
    return UsageAllocationModel().fit(pl.DataFrame(rows))


def _prior(position: str, key: str, mean: float) -> Prior:
    return Prior(
        season=2023, stat_type=key, position=position,
        fitted_from_seasons=(2021, 2022), sample_games=100, sample_players=20,
        mean=mean, variance=1.0,
    )


def _efficiency_model() -> EfficiencyModel:
    priors: dict[tuple[str, str], Prior] = {}
    defaults = {
        "yards_per_target": 8.0, "catch_rate": 0.65, "rec_td_rate": 0.06,
        "yards_per_carry": 4.3, "rush_td_rate": 0.04,
        "yards_per_pass_attempt": 7.5, "pass_td_rate": 0.05,
    }
    for position in ("QB", "WR", "RB", "TE", "FB"):
        for key in EFFICIENCY_KEYS:
            priors[(position, key)] = _prior(position, key, defaults[key])
    return EfficiencyModel(priors=priors)


def _models() -> sim.SimulationModels:
    return sim.SimulationModels(
        game_environment=_env_model(),
        usage=_usage_model(),
        efficiency=_efficiency_model(),
    )


def _config(artifact_base, **overrides) -> RunConfig:
    base = dict(
        season_from=2023, season_to=2023, stat_types=STAT_TYPES,
        season_types=("REG",), evaluation_window="development",
        artifact_base=artifact_base,
    )
    base.update(overrides)
    return RunConfig(**base)


# --- A real simulation run ---------------------------------------------------


def test_simulation_run_stores_its_identity_bins_and_per_layer_blocks(
    corpus, artifact_base
) -> None:
    outcome = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )
    assert outcome.status == "completed", outcome.error

    stored = persist.load_run(corpus, outcome.run_id)
    assert stored["model_version"] == SIMULATION_MODEL_VERSION
    assert stored["seed"] != 0
    assert stored["rng_draws"] == DRAW_COUNT
    assert stored["aggregates"]["aggregatesVersion"] == 3

    # engine_config is the simulation config (RD-6 draw count, seed policy).
    assert stored["aggregates"]  # completed runs carry aggregates
    engine_cfg = stored["engine_config_digest"]
    assert engine_cfg  # digest present

    # The population reconciles, exactly as the baseline harness requires.
    totals = outcome.totals
    assert totals.candidates > 0
    assert (
        totals.projected + totals.unprojectable + totals.excluded
        == totals.candidates
    )

    # Per-layer validation blocks (RD-8): a regression localises to a layer.
    per_layer = stored["aggregates"]["perLayer"]
    assert "gameEnvironment" in per_layer
    assert "playsMae" in per_layer["gameEnvironment"]
    assert "passRushSplitMae" in per_layer["gameEnvironment"]
    assert "usageAllocation" in per_layer
    assert "targetShareMae" in per_layer["usageAllocation"]
    assert "carryShareMae" in per_layer["usageAllocation"]

    # Calibration bins landed with the run.
    bins = persist.load_calibration_bins(corpus, outcome.run_id)
    assert bins

    # Every stored projection is attributed to the simulation model version.
    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    assert predictions.height == totals.projected
    assert set(predictions["model_version"].to_list()) == {SIMULATION_MODEL_VERSION}
    assert set(predictions["distribution_kind"].to_list()) <= {
        "empirical_quantiles", "empirical_pmf"
    }


def test_no_simulation_prediction_was_computed_after_its_own_kickoff(
    corpus, artifact_base
) -> None:
    outcome = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )
    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    late = predictions.filter(
        pl.col("information_cutoff") >= pl.col("kickoff_at")
    )
    assert late.height == 0, late


# --- R5: reproducibility over an unchanged corpus ----------------------------


def test_simulation_run_reproduces_all_three_digests(corpus, artifact_base) -> None:
    first = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )
    second = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )
    assert first.status == "completed" and second.status == "completed"
    assert first.run_id != second.run_id, "experiment history is preserved"
    assert first.predictions_digest == second.predictions_digest
    assert first.aggregate_digest == second.aggregate_digest
    assert first.calibration_digest == second.calibration_digest


# --- Point-in-time discipline: a post-cutoff fact does not move a prediction --


def test_a_post_cutoff_fact_does_not_change_a_simulation_prediction(
    corpus, artifact_base
) -> None:
    # The canonical leakage assertion, for the simulation model version. Run
    # once, then plant a fact whose known_at postdates every cutoff (a stat line
    # for a game AFTER the run window), and assert the digest is unchanged: an
    # as-of read cannot see a fact that did not exist at the cutoff.
    before = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )

    # Plant a future-published stat correction for an EARLIER game, with a
    # known_at far in the future — the correction roll-back must hide it from
    # every feature read at the run's cutoffs.
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            "update player_game_stats set receiving_yards = receiving_yards + 999, "
            "version = version + 1, known_at = now() + interval '3650 days' "
            "where player_id = %s and game_id = %s",
            ("00-0031000", game_id(GAMES[0])),
        )
        conn.commit()

    after = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )
    assert after.predictions_digest == before.predictions_digest, (
        "a fact known only after the cutoff leaked into a simulation prediction"
    )


# --- Promotion bar (RD-1): pure-function truth table -------------------------


def test_meets_promotion_bar_truth_table() -> None:
    # Margin: just below / at / above 0.01 absolute (lower Brier is better).
    assert meets_promotion_bar(0.190, 0.199, 500, 2) is False  # 0.009 < 0.01
    assert meets_promotion_bar(0.190, 0.200, 500, 2) is True   # exactly 0.01
    assert meets_promotion_bar(0.180, 0.200, 500, 2) is True   # 0.02 > 0.01
    # A simulation that is WORSE never promotes.
    assert meets_promotion_bar(0.210, 0.200, 5000, 5) is False

    # Sample size floor: 499 vs 500 at a comfortable margin and seasons.
    assert meets_promotion_bar(0.10, 0.20, 499, 2) is False
    assert meets_promotion_bar(0.10, 0.20, 500, 2) is True

    # Season floor: 1 vs 2 seasons.
    assert meets_promotion_bar(0.10, 0.20, 5000, 1) is False
    assert meets_promotion_bar(0.10, 0.20, 5000, 2) is True


def test_compare_stat_type_briers_on_hand_aggregates() -> None:
    # Two stat types: one where simulation clears the bar, one where it does not,
    # plus a stat present in only one run (dropped, never a fabricated zero).
    def _agg(stat_briers: dict[str, tuple[float, int]]) -> dict:
        by_stat = {
            stat: {"thresholds": {"brier": brier, "projections": n,
                                  "observations": n, "logLoss": 0.1}}
            for stat, (brier, n) in stat_briers.items()
        }
        return {"contractLike": {"byStatType": by_stat}}

    sim_agg = _agg({
        "receiving_yards": (0.180, 600),  # beats baseline by 0.02 on 600
        "rushing_yards": (0.205, 600),    # loses to baseline
        "receptions": (0.150, 600),       # only in sim -> dropped
    })
    baseline_agg = _agg({
        "receiving_yards": (0.200, 700),
        "rushing_yards": (0.200, 700),
    })

    result = compare_stat_type_briers(sim_agg, baseline_agg, seasons_covered=2)

    assert set(result) == {"receiving_yards", "rushing_yards"}  # receptions dropped
    ry = result["receiving_yards"]
    assert ry["sim_brier"] == pytest.approx(0.180)
    assert ry["baseline_brier"] == pytest.approx(0.200)
    assert ry["delta"] == pytest.approx(0.020)
    assert ry["n"] == 600  # min of 600 and 700
    assert ry["promotes"] is True

    rush = result["rushing_yards"]
    assert rush["delta"] == pytest.approx(-0.005)
    assert rush["promotes"] is False


def test_compare_reads_briers_from_a_real_run(corpus, artifact_base) -> None:
    # The comparison helper works on the aggregates a completed run actually
    # stores: a simulation run and a baseline run over the same corpus both carry
    # a contract-like per-stat Brier, so the comparison is computable end to end.
    from sightline_model.harness import run_backtest

    sim_out = sim.run_simulation_backtest(
        corpus, _config(artifact_base), models=_models(), persist=persist
    )
    base_out = run_backtest(corpus, _config(artifact_base), persist=persist)

    sim_agg = persist.load_run(corpus, sim_out.run_id)["aggregates"]
    base_agg = persist.load_run(corpus, base_out.run_id)["aggregates"]

    # Both runs must carry the contract-like per-stat block the comparison reads.
    result = compare_stat_type_briers(sim_agg, base_agg, seasons_covered=1)
    # seasons_covered=1 is below the floor, so nothing promotes regardless of
    # margin — proving the seasons gate binds on real data.
    assert all(not v["promotes"] for v in result.values())
    for v in result.values():
        assert "sim_brier" in v and "baseline_brier" in v and "delta" in v


# --- Model-version attribution ----------------------------------------------


def test_promoting_one_stat_type_does_not_change_another_baseline_attribution(
    corpus, artifact_base
) -> None:
    # Projections are immutable per (player, game, stat, model_version, cutoff);
    # a ModelSelection change only decides which model_version is READ. Flipping
    # one stat type's selection to simulation must not alter the stored
    # model_version of any other stat type's historical baseline projections.
    #
    # Persist baseline projections for two stat types, then flip ONE stat type's
    # ModelSelection to simulation and assert the OTHER stat type's baseline
    # projection rows are byte-unchanged.
    from sightline_model.constants import MODEL_VERSION

    cutoff = datetime(2023, 9, 24, 12, 0)
    with corpus() as conn, conn.cursor() as cur:
        # The ModelSelection seed rows (all six stat types on the baseline) are
        # truncated by clean_db, so re-establish the two we exercise here.
        for stat_type in ("receiving_yards", "rushing_yards"):
            cur.execute(
                'insert into model_selections (stat_type, model_version, '
                'promoted_at, updated_at) values (%s::"StatType", %s, now(), now()) '
                'on conflict (stat_type) do update set model_version = excluded.model_version',
                (stat_type, MODEL_VERSION),
            )
        for stat_type in ("receiving_yards", "rushing_yards"):
            cur.execute(
                """
                insert into projections (
                    id, player_id, game_id, stat_type, model_version,
                    distribution_kind, params, quantiles, projected_value,
                    projected_median, interval_low, interval_high, confidence,
                    n_eff, information_cutoff, computed_at
                ) values (
                    gen_random_uuid(), %(pid)s, %(gid)s, %(stat)s::"StatType",
                    %(mv)s, 'zero_inflated_lognormal', '{}'::jsonb, '{}'::jsonb,
                    50.0, 48.0, 20.0, 80.0, 'medium'::"Confidence", 5,
                    %(cutoff)s, %(cutoff)s
                )
                """,
                {
                    "pid": player_id("00-0031000"), "gid": game_id(GAMES[2]),
                    "stat": stat_type, "mv": MODEL_VERSION, "cutoff": cutoff,
                },
            )
        conn.commit()

        def _attribution(stat_type: str) -> list[tuple]:
            cur.execute(
                'select model_version, projected_value from projections '
                'where stat_type = %s::"StatType" order by model_version',
                (stat_type,),
            )
            return cur.fetchall()

        before = _attribution("rushing_yards")

        # "Promote" receiving_yards: flip its ModelSelection to simulation.
        cur.execute(
            'update model_selections set model_version = %s '
            'where stat_type = %s::"StatType"',
            (SIMULATION_MODEL_VERSION, "receiving_yards"),
        )
        conn.commit()

        after = _attribution("rushing_yards")

    assert before == after, (
        "a ModelSelection change altered another stat type's baseline "
        "projection attribution"
    )
    # And the flipped stat's selection changed while its historical projection
    # attribution (the row we inserted) did not.
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            'select model_version from model_selections '
            'where stat_type = %s::"StatType"',
            ("receiving_yards",),
        )
        assert cur.fetchone()[0] == SIMULATION_MODEL_VERSION
        cur.execute(
            'select distinct model_version from projections '
            'where stat_type = %s::"StatType"',
            ("receiving_yards",),
        )
        assert cur.fetchone()[0] == MODEL_VERSION  # the projection is unchanged
