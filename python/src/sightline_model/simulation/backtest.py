"""Backtest-harness integration for the Simulation Engine (SIG-70).

The baseline harness projects each candidate *per player*; the Simulation Engine
is *per game* (joint). This module plugs the joint engine into the *same*
chronological lifecycle the baseline uses — :func:`sightline_model.harness.run_backtest`
enumerates games chronologically, derives the kickoff-minus-90m cutoff, binds an
:class:`AsOfCorpus` for features and a walled-off :class:`GradingCorpus` for
actuals, writes Parquet artefacts, summarises, digests, and completes the run
atomically. Nothing here re-implements any of that. It supplies only what the
baseline scaffold cannot know:

* the model identity — ``model_version = simulation-mc-0.1.0``, a non-zero
  derived ``seed``, ``rng_draws = 5000``, and ``engine_config()`` from the
  simulation config — as a :class:`~sightline_model.harness.RunModel`; and
* a per-game ``execute`` that assembles Layers 1-2 as-of, runs
  :func:`~sightline_model.simulation.core.simulate_game`, grades each projected
  (player, stat) against the corrected line, and writes the prediction /
  threshold / exclusion rows in the **exact** shape the baseline path writes,
  plus the per-layer validation rows (RD-8).

Point-in-time discipline is inherited, not re-earned: every feature read goes
through the cutoff-bound ``AsOfCorpus`` (the same object the baseline uses), and
actuals come only from ``GradingCorpus`` — never a raw fact read. No price,
recommendation, or edge is imported; the import-graph guard sweeps this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.db import ConnectionFactory
from sightline_ingest.grading import GradingCorpus

from .. import artifacts as art
from .. import harness as hz
from ..constants import CUTOFF_SCHEDULE_LOOKBACK_DAYS, is_contract_like
from ..projection import Unprojectable
from ..stat_types import sort_key as stat_sort_key
from ..stat_types import spec
from .config import DRAW_COUNT, SIMULATION_MODEL_VERSION, engine_config
from .core import (
    PlayerSimInput,
    SimulatedProjection,
    prob_at_least_from_pmf,
    prob_at_least_from_quantiles,
    simulate_game,
)
from .efficiency import EfficiencyHistory, EfficiencyModel
from .game_environment import (
    GameEnvironmentModel,
    assemble_game_environment_features,
    game_environment_mae,
)
from .seed import derive_seed
from .usage_allocation import (
    UsageAllocationModel,
    allocate_shares,
    assemble_usage_features,
    usage_share_mae,
)

REASON_NO_ACTUAL = hz.REASON_NO_ACTUAL
REASON_INSUFFICIENT_EVIDENCE = "insufficient_evidence"
STAGE_ENGINE = hz.STAGE_ENGINE
STAGE_HARNESS = hz.STAGE_HARNESS

# The stat types the simulation engine can store, keyed to their compact form.
# A requested stat outside this set is silently omitted by the core; here it
# bounds the candidate set to what the engine actually projects.
_SIM_STAT_TYPES = frozenset(
    ("passing_yards", "rushing_yards", "receiving_yards",
     "receptions", "rushing_tds", "receiving_tds")
)


@dataclass(frozen=True)
class SimulationModels:
    """The three fitted (or, in tests, synthetic) layer models the engine reads.

    Fitting is a human-run offline step (SIG-67/68/69); the backtest is handed
    already-fitted models exactly as production will be. Tests pass small
    pre-fit or synthetic instances. Bundling them keeps the run signature honest
    about its three inputs rather than threading three positional models through
    the lifecycle.
    """

    game_environment: GameEnvironmentModel
    usage: UsageAllocationModel
    efficiency: EfficiencyModel


def run_simulation_backtest(
    connect: ConnectionFactory,
    config: hz.RunConfig,
    *,
    models: SimulationModels,
    persist,
    now: datetime | None = None,
) -> hz.RunOutcome:
    """Run a Simulation-Engine backtest through the baseline harness lifecycle.

    Identical scaffold to :func:`sightline_model.harness.run_backtest` — same
    game enumeration, cutoff derivation, grading corpus, artefact writing,
    summarising, digesting, and atomic completion — differing only in the model
    identity and the per-game execution, both carried on the
    :class:`~sightline_model.harness.RunModel` handed to the shared runner.
    """
    def _execute(connect_, config_, writer, totals, interrupted, started):
        _execute_simulation(
            connect_, config_, writer, totals, interrupted, started, models=models
        )

    model = hz.RunModel(
        model_version=SIMULATION_MODEL_VERSION,
        # A non-zero, deterministic run seed: derived from the run's own
        # configuration so two identical runs seed identically and two different
        # experiments do not collide. The PER-GAME seeds the simulation core uses
        # are derived separately inside ``simulate_game`` from (game, version,
        # cutoff); this run-level seed is the stored provenance value the spec
        # requires to be non-zero (R5: seed is part of the run's identity).
        seed=_run_seed(config),
        rng_draws=DRAW_COUNT,
        engine_config=engine_config(),
        execute=_execute,
        per_layer_dataset=art.PER_LAYER,
    )
    return hz.run_backtest(connect, config, persist=persist, now=now, model=model)


def _run_seed(config: hz.RunConfig) -> int:
    """A non-zero run-level seed derived from the run configuration (R5).

    Reuses the same BLAKE2b derivation the per-game seed uses so the value is
    deterministic and platform-stable; the material is the run's span and stat
    set rather than a game, so it identifies the experiment. Never zero: a zero
    seed would be indistinguishable from the baseline's inert placeholder.
    """
    material = (
        f"{config.season_from}-{config.season_to}|"
        f"{','.join(sorted(config.stat_types))}|{config.seed}"
    )
    # ``BacktestRun.seed`` is a 32-bit integer column, so mask the 64-bit
    # derivation into a positive int32 (never zero — a zero seed would be
    # indistinguishable from the baseline's inert placeholder). The full 64-bit
    # per-game seeds the core uses are stored separately on ``GameSimulation``
    # (a BIGINT column, SIG-71); this value is only the run's provenance.
    seed = derive_seed(material, SIMULATION_MODEL_VERSION, _EPOCH) & 0x7FFFFFFF
    return seed or 1


_EPOCH = datetime(1970, 1, 1)


# ---------------------------------------------------------------------------
# Per-game execution — the simulation engine under the baseline discipline.
# ---------------------------------------------------------------------------


def _execute_simulation(
    connect, config, writer, totals, interrupted, started, *, models: SimulationModels
) -> None:
    """Walk games chronologically and simulate each under the as-of cutoff.

    Mirrors :func:`sightline_model.harness._execute`: the same game enumeration,
    the same two-corpus cutoff derivation (a lookback corpus for the schedule as
    known a week out, a cutoff-bound corpus for every feature read), the same
    walled-off grading corpus. The difference is that a whole game is simulated
    jointly and every participant's stat line is graded from that one run.
    """
    grading = GradingCorpus(connect)
    games = hz._games_in_scope(connect, config)
    seasons_by_game = {g["id"]: g["season"] for g in games}
    stat_names = sorted(
        (s for s in config.stat_types if s in _SIM_STAT_TYPES), key=stat_sort_key
    )

    for game in games:
        if interrupted["flag"]:
            return
        kickoff = game["kickoff_at"]
        lookback = AsOfCorpus(
            connect, kickoff - timedelta(days=CUTOFF_SCHEDULE_LOOKBACK_DAYS)
        )
        cutoff = hz.derive_cutoff(lookback, game_id=game["id"], kickoff=kickoff)
        if cutoff >= kickoff:
            # Should never happen; counted and excluded rather than simulated.
            for stat_name in stat_names:
                writer.append(art.EXCLUSIONS, hz._exclusion(
                    game["id"], None, stat_name, STAGE_HARNESS,
                    hz.REASON_CUTOFF_AFTER_KICKOFF, "cutoff at or after kickoff",
                ))
                totals.candidates += 1
                totals.excluded += 1
            continue

        corpus = AsOfCorpus(connect, cutoff)
        era, era_source = hz.weather_era(
            corpus, game_id=game["id"], season=game["season"]
        )
        actuals = hz._actuals_for_game(grading, game["id"])
        _simulate_one_game(
            corpus, writer, totals, models=models, game=game, stat_names=stat_names,
            cutoff=cutoff, kickoff=kickoff, era=era, era_source=era_source,
            actuals=actuals, started=started, seasons_by_game=seasons_by_game,
        )


def _simulate_one_game(
    corpus, writer, totals, *, models: SimulationModels, game, stat_names,
    cutoff, kickoff, era, era_source, actuals, started, seasons_by_game,
) -> None:
    home, away = game["home_abbr"], game["away_abbr"]
    is_dome = bool(game.get("is_dome"))

    # --- Layer 1: game environment (as-of) ---------------------------------
    env_features = assemble_game_environment_features(
        corpus, game_id=game["id"], home_team_abbr=home, away_team_abbr=away,
        is_dome=is_dome,
    )
    environment_pred = models.game_environment.predict(env_features)

    # --- Candidate universe: pre-cutoff participants on the two teams -------
    # Enumerated from pre-cutoff participation (never the target game's own
    # participants — that conditions the population on an outcome), exactly as
    # the baseline harness does. Any of the requested stat columns qualifies a
    # player; positions come with the participant rows (disclosed roster state,
    # accepted as the baseline accepts it).
    positions: dict[str, str | None] = {}
    for stat_name in stat_names:
        stat = spec(stat_name)
        participants = corpus.season_participants(
            seasons=(game["season"] - 1, game["season"]), column=stat.column
        )
        for row in participants.to_dicts():
            positions.setdefault(row["player_id"], row["position"])
    if not positions:
        return

    # --- Layer 2: usage allocation, per team (as-of) -----------------------
    usage_by_team: dict[str, dict[str, dict[str, float]]] = {}
    team_players: dict[str, list[str]] = {home: [], away: []}
    all_players = sorted(positions)
    usage_features = {
        home: assemble_usage_features(
            corpus, game_id=game["id"], team_abbr=home,
            player_ids=all_players, positions=positions,
        ),
        away: assemble_usage_features(
            corpus, game_id=game["id"], team_abbr=away,
            player_ids=all_players, positions=positions,
        ),
    }
    for team in (home, away):
        feats = usage_features[team]
        # A player belongs to this team iff his as-of team (his most recent
        # eligible game's team_abbr_at_game) is this team.
        team_feats = {pid: f for pid, f in feats.items() if f.team_abbr == team}
        team_players[team] = sorted(team_feats)
        scores = (
            models.usage.predict(team_feats) if team_feats else {}
        )
        available = {pid: team_feats[pid].is_available for pid in team_feats}
        shares = allocate_shares(scores, available)
        usage_by_team[team] = {
            "target_shares": {
                pid: s["target_share"] for pid, s in shares.items()
            },
            "carry_shares": {
                pid: s["carry_share"] for pid, s in shares.items()
            },
        }

    # --- Layer 3: efficiency per player, then the joint simulation ---------
    sim_players = []
    trailing = corpus.trailing_player_stats_batch(
        player_ids=all_players, before_game_id=game["id"]
    )
    grouped: dict[str, list[dict]] = {pid: [] for pid in all_players}
    if trailing.height:
        for r in trailing.sort("player_id", "kickoff_at").to_dicts():
            if r["player_id"] in grouped:
                grouped[r["player_id"]].append(r)

    for team in (home, away):
        for pid in team_players[team]:
            history = _efficiency_history(pid, positions.get(pid), grouped[pid])
            efficiency = models.efficiency.predict(history)
            sim_players.append(
                PlayerSimInput(
                    player_id=pid,
                    team_abbr=team,
                    position=positions.get(pid),
                    efficiency=efficiency,
                    n_eff=history.n_eff,
                    requested_stats=tuple(stat_names),
                )
            )

    if not sim_players:
        return

    result = simulate_game(
        game_id=game["id"], information_cutoff=cutoff,
        environment_pred=environment_pred, usage_by_team=usage_by_team,
        players=sim_players, computed_at=started, draw_count=DRAW_COUNT,
    )

    _grade_and_write(
        writer, totals, result=result, game=game, era=era, era_source=era_source,
        cutoff=cutoff, kickoff=kickoff, actuals=actuals, positions=positions,
    )
    _write_per_layer(
        writer, game=game, environment_pred=environment_pred,
        usage_by_team=usage_by_team, actuals=actuals, team_players=team_players,
    )


def _efficiency_history(
    player_id: str, position: str | None, rows: list[dict]
) -> EfficiencyHistory:
    """A player's trailing per-opportunity efficiency, from as-of corpus rows.

    Reduces the publication-bounded, correction-rolled-back trailing stat lines
    (the SAME rows Layer 2 reads) to per-opportunity rates. Never a season
    aggregate: each rate is a ratio of the player's own windowed totals. Absent
    channels are ``None`` so the efficiency model falls them back to the position
    prior rather than fabricating a rate.
    """
    n_eff = len(rows)
    if not rows:
        return EfficiencyHistory(player_id=player_id, position=position, n_eff=0)

    def _sum(col: str) -> float:
        return sum(float(r[col]) for r in rows if r.get(col) is not None)

    targets = _sum("targets")
    receptions = _sum("receptions")
    rec_yards = _sum("receiving_yards")
    rec_tds = _sum("receiving_tds")
    carries = _sum("carries")
    rush_yards = _sum("rushing_yards")
    rush_tds = _sum("rushing_tds")
    pass_att = _sum("passing_attempts")
    pass_yards = _sum("passing_yards")
    pass_tds = _sum("passing_tds")

    return EfficiencyHistory(
        player_id=player_id,
        position=position,
        n_eff=n_eff,
        yards_per_target=(rec_yards / targets) if targets > 0 else None,
        catch_rate=(receptions / targets) if targets > 0 else None,
        rec_td_rate=(rec_tds / targets) if targets > 0 else None,
        yards_per_carry=(rush_yards / carries) if carries > 0 else None,
        rush_td_rate=(rush_tds / carries) if carries > 0 else None,
        yards_per_pass_attempt=(pass_yards / pass_att) if pass_att > 0 else None,
        pass_td_rate=(pass_tds / pass_att) if pass_att > 0 else None,
    )


# ---------------------------------------------------------------------------
# Grading — each projected (player, stat) against the corrected line.
# ---------------------------------------------------------------------------


def _grade_and_write(
    writer, totals, *, result, game, era, era_source, cutoff, kickoff,
    actuals, positions,
) -> None:
    """Write prediction + threshold rows for each projection; exclusions for the rest."""
    for decline in result.declines:
        # An insufficient-evidence decline is the engine's explicit "no
        # distribution" (RD-4), recorded as an exclusion exactly as the baseline
        # records an ``Unprojectable``. Counted so the population reconciles.
        totals.candidates += 1
        totals.unprojectable += 1
        writer.append(art.EXCLUSIONS, hz._exclusion(
            game["id"], decline.player_id, decline.stat_type, STAGE_ENGINE,
            decline.reason, None,
        ))

    for projection in result.projections:
        totals.candidates += 1
        stat = spec(projection.stat_type)
        actual_row = actuals.get(projection.player_id, {})
        actual = actual_row.get(stat.column)
        correction_applied = int(actual_row.get("version") or 1) > 1
        if actual is None:
            totals.excluded += 1
            writer.append(art.EXCLUSIONS, hz._exclusion(
                game["id"], projection.player_id, stat.name, STAGE_HARNESS,
                REASON_NO_ACTUAL, None,
            ))
            continue

        contract_like = is_contract_like(stat.name, projection.projected_value)
        totals.projected += 1
        writer.append(
            art.PREDICTIONS,
            _prediction_row(
                projection, game=game, stat=stat, actual=float(actual),
                era=era, era_source=era_source, kickoff=kickoff,
                position=positions.get(projection.player_id) or "UNK",
                correction_applied=correction_applied, contract_like=contract_like,
            ),
        )
        pred_id = hz._prediction_id(
            game["id"], projection.player_id, stat.name, cutoff,
            SIMULATION_MODEL_VERSION,
        )
        for threshold in stat.thresholds:
            totals.threshold_observations += 1
            writer.append(art.THRESHOLDS, {
                "prediction_id": pred_id,
                "stat_type": stat.name,
                "season": game["season"],
                "weather_era": era,
                "threshold": float(threshold),
                "probability": _prob_at_least(projection, float(threshold)),
                "outcome": bool(float(actual) >= threshold),
                "contract_like": contract_like,
            })


def _prob_at_least(projection: SimulatedProjection, threshold: float) -> float:
    """``P(>= t)`` from the stored compact form — grid interp or PMF tail sum.

    The same rehydration the read path uses (spec: threshold probability is
    derived from the stored representation, never re-simulated), so the graded
    threshold events are computed exactly as the application will compute them.
    """
    if projection.quantiles is not None:
        return prob_at_least_from_quantiles(projection.quantiles, threshold)
    if projection.pmf is not None:
        return prob_at_least_from_pmf(projection.pmf, threshold)
    return 0.0


def _prediction_row(
    projection: SimulatedProjection, *, game, stat, actual, era, era_source,
    kickoff, position, correction_applied, contract_like,
) -> dict:
    """The prediction row, in the EXACT shape the baseline harness writes.

    Same columns, same quantisation keys, so ``metrics`` and ``digests`` treat
    the two engines uniformly. The empirical distribution kind and the fact that
    a count family additionally carrying an explicit ``pmf`` are the only content differences; the
    error/comparison columns are computed identically. The baseline-comparison
    columns (``baseline_season_avg`` etc.) are left null: the per-stat
    Brier-vs-baseline comparison (RD-1) is a cross-run comparison against the
    baseline's OWN stored run, not a per-row baseline carried on the simulation
    prediction — conflating the two would invite reading a within-run baseline
    that this engine never computed.
    """
    import json

    error = actual - projection.projected_value
    error_median = actual - projection.projected_median
    percentile = round(1.0 - _prob_at_least(projection, actual + 1e-9), 4)
    quantile_cols = projection.quantiles or {}
    return {
        "prediction_id": hz._prediction_id(
            game["id"], projection.player_id, stat.name,
            projection.information_cutoff, SIMULATION_MODEL_VERSION,
        ),
        "game_id": game["id"],
        "player_id": projection.player_id,
        "season": game["season"],
        "week": game["week"],
        "season_type": game["season_type"],
        "stat_type": stat.name,
        "position": position,
        "model_version": projection.model_version,
        "distribution_kind": projection.distribution_kind,
        "params": json.dumps(projection.params, sort_keys=True),
        "pmf": json.dumps(projection.pmf) if projection.pmf else None,
        "tail_mass": (projection.pmf[-1] if projection.pmf else None),
        "zero_mass": projection.params.get("zeroMass"),
        **quantile_cols,
        "projected_value": projection.projected_value,
        "projected_median": projection.projected_median,
        "interval_low": projection.interval_low,
        "interval_high": projection.interval_high,
        # A non-negative empirical distribution never places mass below zero.
        "mass_below_zero": 0.0,
        "confidence": projection.confidence,
        "n_eff": projection.n_eff,
        # Relative width is a derived diagnostic; not stored on the empirical
        # projection object. Left null rather than fabricated.
        "relative_width": None,
        "drivers": json.dumps(projection.drivers),
        "information_cutoff": projection.information_cutoff,
        "kickoff_at": kickoff,
        "computed_at": projection.computed_at,
        "weather_era": era,
        "era_source": era_source,
        "actual": actual,
        "actual_percentile": percentile,
        "abs_error": abs(error),
        "sq_error": error * error,
        "abs_error_median": abs(error_median),
        "sq_error_median": error_median * error_median,
        "baseline_season_avg": None,
        "baseline_trailing5": None,
        "baseline_season_avg_abs_error": None,
        "baseline_trailing5_abs_error": None,
        # The simulation engine does not compute the within-run point baselines,
        # so no projection is in the within-run comparison population; the
        # baseline comparison is cross-run (RD-1). Its contract-like Brier is
        # still stored, which is what the promotion bar reads.
        "in_comparison_population": False,
        "correction_applied": correction_applied,
        "contract_like": contract_like,
        "cohorts": json.dumps([]),
    }


# ---------------------------------------------------------------------------
# Per-layer validation (RD-8): one row per (game, layer).
# ---------------------------------------------------------------------------


def _write_per_layer(
    writer, *, game, environment_pred, usage_by_team, actuals, team_players,
) -> None:
    """Write the game's Layer-1 and Layer-2 validation MAEs (RD-8).

    Layer 1 is scored against the game's observed team pass/rush attempts;
    Layer 2 against each player's observed target/carry share, over players who
    recorded a real opportunity. Observed values come from the corrected line via
    ``GradingCorpus`` (``actuals``), never a feature read; players are attributed
    to teams by the as-of Layer-2 assignment (``team_players``), which is
    pre-cutoff information and therefore leak-free. Averaged across games by
    ``metrics._per_layer_block`` into the run's ``perLayer`` aggregate block.
    """
    observed_team = _observed_team_volumes(actuals, team_players)
    if observed_team:
        try:
            env = game_environment_mae(environment_pred, observed_team)
            writer.append(art.PER_LAYER, {
                "game_id": game["id"], "layer": "game_environment",
                "plays_mae": env["plays_mae"],
                "pass_rush_split_mae": env["pass_rush_split_mae"],
            })
        except ValueError:
            pass

    for team, shares in usage_by_team.items():
        predicted, observed, had_opportunity = _team_share_observations(
            shares, actuals
        )
        if not predicted:
            continue
        usage = usage_share_mae(predicted, observed, had_opportunity)
        writer.append(art.PER_LAYER, {
            "game_id": game["id"], "layer": f"usage_{team}",
            "target_share_mae": usage["target_share_mae"],
            "carry_share_mae": usage["carry_share_mae"],
        })


def _observed_team_volumes(
    actuals: dict, team_players: dict[str, list[str]]
) -> dict[str, tuple[float, float]]:
    """Observed (pass_attempts, rush_attempts) per team, from the corrected line.

    Summed over the players the as-of allocation attributed to each team
    (``team_players``), using their observed box score. The team assignment is
    pre-cutoff information (Layer 2's ``team_abbr_at_game``), so no future roster
    state re-enters here; the observed *attempts* are the corrected line, which
    is grading data and may legitimately postdate the game.
    """
    by_team: dict[str, tuple[float, float]] = {}
    for team, players in team_players.items():
        pass_att = sum(
            float(actuals.get(pid, {}).get("passing_attempts") or 0.0)
            for pid in players
        )
        carries = sum(
            float(actuals.get(pid, {}).get("carries") or 0.0) for pid in players
        )
        if players:
            by_team[team] = (pass_att, carries)
    return by_team


def _team_share_observations(shares, actuals):
    """Predicted vs observed target/carry shares for one team's players.

    ``shares`` is the team's ``{target_shares, carry_shares}`` from
    ``allocate_shares``; observed shares are each player's own opportunity over
    the team's total opportunity in the corrected line. Only players who
    recorded a real opportunity (a target or a carry) are marked scorable — the
    usage MAE (RD-8) scores allocation skill, not a bench of correct zeros.
    """
    predicted: dict[str, dict[str, float]] = {}
    for pid in shares["target_shares"]:
        if pid == "__replacement__":
            continue
        predicted[pid] = {
            "target_share": shares["target_shares"].get(pid, 0.0),
            "carry_share": shares["carry_shares"].get(pid, 0.0),
        }
    if not predicted:
        return {}, {}, {}

    # Team totals from the observed line, over the predicted players only.
    team_targets = sum(
        float(actuals.get(pid, {}).get("targets") or 0.0) for pid in predicted
    )
    team_carries = sum(
        float(actuals.get(pid, {}).get("carries") or 0.0) for pid in predicted
    )
    observed: dict[str, dict[str, float]] = {}
    had_opportunity: dict[str, bool] = {}
    for pid in predicted:
        row = actuals.get(pid, {})
        p_targets = float(row.get("targets") or 0.0)
        p_carries = float(row.get("carries") or 0.0)
        observed[pid] = {
            "target_share": (p_targets / team_targets) if team_targets > 0 else 0.0,
            "carry_share": (p_carries / team_carries) if team_carries > 0 else 0.0,
        }
        had_opportunity[pid] = (p_targets > 0.0) or (p_carries > 0.0)
    return predicted, observed, had_opportunity
