"""Offline fit for the three Simulation-Engine layer models (SIG-67/68/69).

Fitting is a human-run batch step, exactly the contract the backtest and the live
path already assume: both are handed already-fitted :class:`SimulationModels` and
never fit in-process. This module produces those artefacts from the historical
corpus and stages them under :func:`default_models_dir` so
:func:`sightline_model.simulation.live.load_simulation_models` can load them.

The load-bearing correctness property is **train/predict feature parity**: the
training rows for each layer are assembled with the SAME as-of assemblers the
prediction path uses (:func:`assemble_game_environment_features`,
:func:`assemble_usage_features`, and the efficiency history reduction), read only
through a cutoff-bound :class:`AsOfCorpus`, and paired with the observed targets
from the walled-off :class:`GradingCorpus`. Nothing here invents a new feature.
The enumeration, the two-corpus cutoff derivation, and the candidate universe
mirror :func:`sightline_model.simulation.backtest._execute_simulation` /
``_simulate_one_game`` so a training row's features are identical to the
prediction-time features for that same (game, cutoff).

Point-in-time discipline is inherited, not re-earned: every feature read goes
through the cutoff-bound corpus. The observed TARGETS legitimately come from the
grading corpus (a target may postdate the game — it is the label, not a feature).
Prices, recommendations, and edges are never imported; the import-graph guard
sweeps this module.

The efficiency layer is not a booster: it carries walk-forward POSITION priors
that the per-player trailing rate is shrunk toward. Its "fit" is computing each
position's mean per-opportunity rate over the training seasons — strictly earlier
than the live season the artefact is used for (2022-2025 fit, 2026 live shadow),
so it cannot leak into live inference.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import polars as pl

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.db import ConnectionFactory
from sightline_ingest.grading import GradingCorpus

from ..constants import CUTOFF_SCHEDULE_LOOKBACK_DAYS
from .. import harness as hz
from ..priors import Prior
from ..stat_types import spec
from .backtest import _efficiency_history
from .efficiency import EFFICIENCY_KEYS, EfficiencyHistory, EfficiencyModel
from .game_environment import (
    FEATURE_COLUMNS as ENV_FEATURES,
    TARGET_COLUMNS as ENV_TARGETS,
    GameEnvironmentModel,
    assemble_game_environment_features,
)
from .live import (
    _EFFICIENCY_MODEL_FILE,
    _ENV_MODEL_FILE,
    _USAGE_MODEL_FILE,
    SimulationModels,
    default_models_dir,
)
from .usage_allocation import (
    FEATURE_COLUMNS as USAGE_FEATURES,
    LABEL_COLUMNS as USAGE_LABELS,
    UsageAllocationModel,
    assemble_usage_features,
)

# The stat columns the candidate universe is enumerated over — the same set the
# backtest simulates, so the training population equals the prediction
# population. A player qualifies as a candidate if he participated (pre-cutoff)
# in ANY of these phases.
_ENUMERATION_STATS = (
    "passing_yards", "rushing_yards", "receiving_yards",
    "receptions", "rushing_tds", "receiving_tds",
)

# The five roster positions the usage layer and efficiency priors recognise.
_POSITIONS = ("QB", "RB", "FB", "WR", "TE")


@dataclass
class _EnvRow:
    features: dict[str, float | None]
    pass_attempts: float
    rush_attempts: float


def fit_simulation_models(
    connect: ConnectionFactory,
    seasons: tuple[int, ...],
    *,
    season_types: tuple[str, ...] = ("REG",),
    progress: object = None,
    workers: int = 1,
) -> SimulationModels:
    """Fit all three layer models on historical ``seasons``.

    Iterates every game in ``seasons`` chronologically, deriving each game's
    kickoff-minus-90m cutoff exactly as the backtest does, assembling each
    layer's features as-of that cutoff and pairing them with the observed targets
    from the grading corpus. The stacked frames are handed to each model's
    ``fit`` with the exact FEATURE + TARGET/LABEL columns it expects.

    ``workers`` shards the (independent, deterministic) per-game assembly across
    processes; the assembled rows are order-normalised before fitting so the
    fitted artefact does not depend on the shard count. The assemblers, cutoff
    derivation, and grading reads are byte-identical to the serial path.
    """
    config = hz.RunConfig(
        season_from=min(seasons),
        season_to=max(seasons),
        stat_types=_ENUMERATION_STATS,
        season_types=season_types,
    )
    games = [g for g in hz._games_in_scope(connect, config) if g["season"] in seasons]
    if progress is not None:
        progress(f"enumerated {len(games)} games across seasons {seasons}")

    env_rows, usage_rows, eff_totals = _assemble_rows(
        connect, games, workers=workers, progress=progress
    )

    if not env_rows:
        raise RuntimeError(
            "no game-environment training rows assembled; the corpus has no "
            "gradable games in the requested seasons"
        )
    if not usage_rows:
        raise RuntimeError("no usage-allocation training rows assembled")

    # Order-normalise so the fitted artefact does not depend on the worker count
    # or the order shards completed in. A null sorts consistently via the sentinel.
    def _key(cols: tuple[str, ...]):
        return lambda r: tuple(
            (r.get(c) is None, r.get(c) if r.get(c) is not None else 0.0)
            for c in cols
        )

    env_rows = sorted(env_rows, key=_key((*ENV_FEATURES, *ENV_TARGETS)))
    usage_rows = sorted(usage_rows, key=_key((*USAGE_FEATURES, *USAGE_LABELS)))

    env_frame = _fillable_for_fit(
        pl.DataFrame(env_rows).select([*ENV_FEATURES, *ENV_TARGETS]),
        feature_columns=ENV_FEATURES, progress=progress,
    )
    usage_frame = _fillable_for_fit(
        pl.DataFrame(usage_rows).select([*USAGE_FEATURES, *USAGE_LABELS]),
        feature_columns=USAGE_FEATURES, progress=progress,
    )
    env_model = GameEnvironmentModel().fit(env_frame)
    usage_model = UsageAllocationModel().fit(usage_frame)
    efficiency_model = EfficiencyModel(priors=_efficiency_priors(eff_totals, seasons))

    return SimulationModels(
        game_environment=env_model,
        usage=usage_model,
        efficiency=efficiency_model,
    )


# The worker's connection factory, set once per worker process by the pool
# initialiser so each process opens its OWN connections (a psycopg connection is
# not shareable across processes). The DSN is resolved from the environment the
# same way the serial path resolves it.
_WORKER_CONNECT: ConnectionFactory | None = None


def _worker_init() -> None:
    global _WORKER_CONNECT
    from sightline_ingest.db import connection_factory

    _WORKER_CONNECT = connection_factory()


def _assemble_games_worker(games: list[dict]) -> tuple[list[dict], list[dict], dict]:
    """Assemble a shard of games in a worker process; return the three row sets.

    Uses the process-local connection factory. Byte-identical assembly to the
    serial path — the only difference is that a subset of games is handled here.
    """
    assert _WORKER_CONNECT is not None, "worker connection factory not initialised"
    return _assemble_shard(_WORKER_CONNECT, games)


def _assemble_shard(
    connect: ConnectionFactory, games: list[dict]
) -> tuple[list[dict], list[dict], dict]:
    """Assemble a list of games serially against ``connect``; return row sets."""
    grading = GradingCorpus(connect)
    env_rows: list[dict] = []
    usage_rows: list[dict] = []
    eff_totals: dict[tuple[str, str], dict[str, float]] = {}
    for game in games:
        kickoff = game["kickoff_at"]
        lookback = AsOfCorpus(
            connect, kickoff - timedelta(days=CUTOFF_SCHEDULE_LOOKBACK_DAYS)
        )
        cutoff = hz.derive_cutoff(lookback, game_id=game["id"], kickoff=kickoff)
        if cutoff >= kickoff:
            continue
        corpus = AsOfCorpus(connect, cutoff)
        actuals = hz._actuals_for_game(grading, game["id"])
        if not actuals:
            continue
        _accumulate_game(
            corpus, game=game, actuals=actuals,
            env_rows=env_rows, usage_rows=usage_rows, eff_totals=eff_totals,
        )
    return env_rows, usage_rows, eff_totals


def _merge_eff(
    into: dict[tuple[str, str], dict[str, float]],
    other: dict[tuple[str, str], dict[str, float]],
) -> None:
    for key, pool in other.items():
        agg = into.setdefault(key, {"sum": 0.0, "count": 0.0})
        agg["sum"] += pool["sum"]
        agg["count"] += pool["count"]


def _assemble_rows(
    connect: ConnectionFactory,
    games: list[dict],
    *,
    workers: int,
    progress: object,
) -> tuple[list[dict], list[dict], dict[tuple[str, str], dict[str, float]]]:
    """Assemble all training rows, serially or sharded across ``workers``.

    Sharding is over games, which assemble independently and deterministically,
    so the combined row multiset is identical to the serial path regardless of
    worker count. Rows are order-normalised by the caller before fitting so the
    fitted artefact is shard-count-independent.
    """
    if workers <= 1:
        env_rows, usage_rows, eff_totals = _assemble_shard(connect, games)
        if progress is not None:
            progress(
                f"  assembled {len(games)} games "
                f"(env={len(env_rows)}, usage={len(usage_rows)})"
            )
        return env_rows, usage_rows, eff_totals

    import concurrent.futures as cf

    # Contiguous shards keep each worker's games chronologically close (similar
    # candidate universes), which is only a cache nicety; correctness does not
    # depend on the split.
    shards = [games[k::workers] for k in range(workers)]
    env_rows: list[dict] = []
    usage_rows: list[dict] = []
    eff_totals: dict[tuple[str, str], dict[str, float]] = {}
    done = 0
    with cf.ProcessPoolExecutor(
        max_workers=workers, initializer=_worker_init
    ) as ex:
        for e, u, eff in ex.map(_assemble_games_worker, shards):
            env_rows.extend(e)
            usage_rows.extend(u)
            _merge_eff(eff_totals, eff)
            done += 1
            if progress is not None:
                progress(
                    f"  shard {done}/{workers} done "
                    f"(env={len(env_rows)}, usage={len(usage_rows)})"
                )
    return env_rows, usage_rows, eff_totals


def _fillable_for_fit(
    frame: pl.DataFrame, *, feature_columns: tuple[str, ...], progress: object
) -> pl.DataFrame:
    """Neutralise entirely-missing feature columns so the booster can fit.

    The sanctioned histogram booster tolerates NaN at PREDICT time (a missing
    feature is a first-class "missing" bin), but its FIT-time binning crashes on
    a feature column that is *wholly* absent across the whole training frame —
    it has zero distinct values to threshold. This happens when a source is not
    present in the corpus at all (e.g. weather has not been ingested for the
    fitted seasons): the three weather columns come through 100% null.

    Replacing an all-null feature column with a constant ``0.0`` is a strict
    no-op for the model: a constant column carries no signal, so no tree split
    is ever learned on it, and at predict time the still-NaN feature flows
    through exactly as before. This preserves FEATURE_COLUMNS (so the artefact's
    load-time feature guard still matches) and changes no prediction — it only
    lets the fit proceed on the features that DO have signal. A column that is
    merely sparse (has >= 2 distinct non-null values) is left untouched.
    """
    dropped: list[str] = []
    exprs = []
    for col in feature_columns:
        if frame[col].null_count() == frame.height:
            exprs.append(pl.lit(0.0).alias(col))
            dropped.append(col)
    if exprs:
        frame = frame.with_columns(exprs)
        if progress is not None:
            progress(
                f"  note: feature column(s) wholly absent in the corpus, "
                f"neutralised to a no-signal constant for the fit: {dropped}"
            )
    return frame


def _accumulate_game(
    corpus: AsOfCorpus, *, game: dict, actuals: dict,
    env_rows: list[dict], usage_rows: list[dict],
    eff_totals: dict[tuple[str, str], dict[str, float]],
) -> None:
    """Assemble one game's training rows for all three layers, in-place.

    Mirrors ``backtest._simulate_one_game``: the same as-of Layer-1 feature
    assembly, the same pre-cutoff candidate universe, the same per-team usage
    feature assembly and as-of team attribution, and the same efficiency-history
    reduction. Only the pairing with observed targets differs — this is the fit,
    not the prediction.
    """
    home, away = game["home_abbr"], game["away_abbr"]
    is_dome = bool(game.get("is_dome"))

    # --- Layer 1: game-environment features (as-of) ------------------------
    env_features = assemble_game_environment_features(
        corpus, game_id=game["id"], home_team_abbr=home, away_team_abbr=away,
        is_dome=is_dome,
    )

    # --- Candidate universe: pre-cutoff participants on the two teams --------
    positions: dict[str, str | None] = {}
    for stat_name in _ENUMERATION_STATS:
        stat = spec(stat_name)
        participants = corpus.season_participants(
            seasons=(game["season"] - 1, game["season"]), column=stat.column
        )
        for row in participants.to_dicts():
            positions.setdefault(row["player_id"], row["position"])
    if not positions:
        return
    all_players = sorted(positions)

    # --- Layer 2: usage features per team (as-of), observed shares as labels -
    usage_features = {
        team: assemble_usage_features(
            corpus, game_id=game["id"], team_abbr=team,
            player_ids=all_players, positions=positions,
        )
        for team in (home, away)
    }
    # The as-of team assignment (Layer-2's ``team_abbr_at_game``), identical to
    # the backtest: a player belongs to a team iff his most recent eligible game
    # was for that team. This is pre-cutoff information; it is how the backtest
    # attributes observed volumes to teams and is the only team key available
    # (the grading line carries no team column on this read path).
    team_players: dict[str, list[str]] = {}
    for team in (home, away):
        team_feats = {
            pid: f for pid, f in usage_features[team].items() if f.team_abbr == team
        }
        team_players[team] = sorted(team_feats)
        if not team_feats:
            continue
        obs_shares = _observed_shares_for_team(list(team_feats), actuals)
        for pid, feats in team_feats.items():
            share = obs_shares.get(pid)
            if share is None:
                # No observed opportunity for this player in this game -> not a
                # usage training label (mirrors the RD-8 scoring rule: a bench of
                # correct zeros is not what the scorer learns allocation from).
                continue
            usage_rows.append({
                **feats.feature_row(),
                "observed_target_share": share[0],
                "observed_carry_share": share[1],
            })

    # --- Layer 1 targets: observed team volumes, mirroring the backtest ------
    # Summed over the players the as-of allocation attributed to each team,
    # exactly as ``backtest._observed_team_volumes`` does. Keyed by team abbr so
    # each per-team feature row (env_features.teams) pairs with its own volume.
    observed_volumes = _observed_team_volumes(actuals, team_players)
    for team_feats in env_features.teams:
        obs = observed_volumes.get(team_feats.team_abbr)
        if obs is None:
            # A team with no as-of participants (e.g. week 1 with no prior data)
            # contributes no Layer-1 target row rather than a fabricated zero.
            continue
        env_rows.append({**team_feats.feature_row(), "pass_attempts": obs[0],
                         "rush_attempts": obs[1]})

    # --- Layer 3: observed per-opportunity efficiency, accrued into priors ---
    _accumulate_efficiency(all_players, positions, actuals, eff_totals)


def _observed_team_volumes(
    actuals: dict, team_players: dict[str, list[str]]
) -> dict[str, tuple[float, float]]:
    """Observed (pass_attempts, rush_attempts) per team, from the corrected line.

    Byte-identical reduction to ``backtest._observed_team_volumes``: summed over
    the players the as-of allocation attributed to each team (``team_players``),
    using their observed box score. The team assignment is pre-cutoff
    information (Layer 2's ``team_abbr_at_game``); the observed attempts are the
    corrected line, which is the training TARGET and may legitimately postdate
    the game.
    """
    by_team: dict[str, tuple[float, float]] = {}
    for team, players in team_players.items():
        if not players:
            continue
        pass_att = sum(
            float(actuals.get(pid, {}).get("passing_attempts") or 0.0)
            for pid in players
        )
        carries = sum(
            float(actuals.get(pid, {}).get("carries") or 0.0) for pid in players
        )
        by_team[team] = (pass_att, carries)
    return by_team


def _observed_shares_for_team(
    player_ids: list[str], actuals: dict
) -> dict[str, tuple[float, float]]:
    """Observed (target_share, carry_share) for a team's players.

    Each share is the player's own opportunity over the team's total opportunity
    in the corrected line, over exactly the players the as-of allocation
    attributed to this team — the same denominator the backtest's
    ``_team_share_observations`` uses. Only players who recorded a real
    opportunity (a target or a carry) are returned; a player who did not compete
    for the ball is not a training label for allocation skill.
    """
    team_targets = sum(
        float(actuals.get(pid, {}).get("targets") or 0.0) for pid in player_ids
    )
    team_carries = sum(
        float(actuals.get(pid, {}).get("carries") or 0.0) for pid in player_ids
    )
    out: dict[str, tuple[float, float]] = {}
    for pid in player_ids:
        row = actuals.get(pid, {})
        p_targets = float(row.get("targets") or 0.0)
        p_carries = float(row.get("carries") or 0.0)
        if p_targets <= 0.0 and p_carries <= 0.0:
            continue
        out[pid] = (
            (p_targets / team_targets) if team_targets > 0 else 0.0,
            (p_carries / team_carries) if team_carries > 0 else 0.0,
        )
    return out


def _accumulate_efficiency(
    player_ids: list[str], positions: dict[str, str | None], actuals: dict,
    eff_totals: dict[tuple[str, str], dict[str, float]],
) -> None:
    """Accrue observed per-opportunity rates into per-(position, key) prior pools.

    The observed per-opportunity rates are exactly the ones
    :func:`backtest._efficiency_history` computes for the trailing history, here
    applied to the game's OWN corrected line (the label) so the position prior is
    an average of realised rates rather than of raw totals. Only channels with a
    real denominator (targets/carries/pass attempts > 0) contribute, so a
    non-receiver never dilutes ``yards_per_target``.
    """
    for pid in player_ids:
        row = actuals.get(pid)
        if not row:
            continue
        position = positions.get(pid)
        if position is None:
            continue
        rates = _observed_efficiency_rates(row)
        for key, value in rates.items():
            if value is None:
                continue
            pool = eff_totals.setdefault((position, key), {"sum": 0.0, "count": 0.0})
            pool["sum"] += value
            pool["count"] += 1.0


def _observed_efficiency_rates(row: dict) -> dict[str, float | None]:
    """Per-opportunity efficiency rates from a single corrected stat line.

    Identical ratio definitions to ``backtest._efficiency_history`` (yards per
    target, catch rate, per-carry, per-attempt, TD rates), applied to one game's
    line. ``None`` where the channel's denominator is zero.
    """
    def _f(col: str) -> float:
        return float(row.get(col) or 0.0)

    targets = _f("targets")
    receptions = _f("receptions")
    rec_yards = _f("receiving_yards")
    rec_tds = _f("receiving_tds")
    carries = _f("carries")
    rush_yards = _f("rushing_yards")
    rush_tds = _f("rushing_tds")
    pass_att = _f("passing_attempts")
    pass_yards = _f("passing_yards")
    pass_tds = _f("passing_tds")

    return {
        "yards_per_target": (rec_yards / targets) if targets > 0 else None,
        "catch_rate": (receptions / targets) if targets > 0 else None,
        "rec_td_rate": (rec_tds / targets) if targets > 0 else None,
        "yards_per_carry": (rush_yards / carries) if carries > 0 else None,
        "rush_td_rate": (rush_tds / carries) if carries > 0 else None,
        "yards_per_pass_attempt": (pass_yards / pass_att) if pass_att > 0 else None,
        "pass_td_rate": (pass_tds / pass_att) if pass_att > 0 else None,
    }


def _efficiency_priors(
    eff_totals: dict[tuple[str, str], dict[str, float]],
    seasons: tuple[int, ...],
) -> dict[tuple[str, str], Prior]:
    """Position priors keyed by ``(position, efficiency_key)``, mean = avg rate.

    Each ``Prior.mean`` is the average observed per-opportunity rate for that
    position/channel over the training seasons. Only the ``mean`` is read by
    :meth:`EfficiencyModel.predict` (via ``_prior_mean``); the remaining fields
    are provenance so a prior drawn from a handful of games is distinguishable
    from one drawn from thousands. ``fitted_from_seasons`` records the training
    window, which is strictly earlier than the live season the artefact serves.
    """
    priors: dict[tuple[str, str], Prior] = {}
    for (position, key), pool in eff_totals.items():
        if pool["count"] <= 0:
            continue
        priors[(position, key)] = Prior(
            # Season is the earliest season an artefact fitted on this window may
            # serve; only ``mean`` is consumed at predict time.
            season=max(seasons) + 1,
            stat_type=key,
            position=position,
            fitted_from_seasons=tuple(sorted(seasons)),
            sample_games=int(pool["count"]),
            sample_players=0,
            mean=pool["sum"] / pool["count"],
            variance=None,
        )
    return priors


def save_simulation_models(
    models: SimulationModels, out_dir: Path | None = None
) -> Path:
    """Persist each layer model via its own ``.save`` under ``out_dir``.

    Defaults to :func:`default_models_dir` (``python/artifacts/simulation-models``),
    the directory :func:`load_simulation_models` reads. Returns the directory.
    """
    base = Path(out_dir) if out_dir is not None else default_models_dir()
    base.mkdir(parents=True, exist_ok=True)
    models.game_environment.save(base / _ENV_MODEL_FILE)
    models.usage.save(base / _USAGE_MODEL_FILE)
    models.efficiency.save(base / _EFFICIENCY_MODEL_FILE)
    return base


def main() -> None:
    """Fit on seasons 2022-2025 and stage the artefacts.

    2026 is deliberately left out so it can serve as the live shadow-evaluation
    season against models that never saw it. Reads the corpus over the direct
    connection the ingest runtime resolves (``INGEST_DATABASE_URL`` or
    ``DIRECT_URL``); writes only local artefact files, never the database.
    """
    from sightline_ingest.db import connection_factory

    import os
    import sys

    def _log(msg: str) -> None:
        print(msg, flush=True)

    seasons = (2022, 2023, 2024, 2025)
    # Per-game assembly is I/O-bound on many small as-of reads; shard it across
    # processes. Overridable via SIGHTLINE_FIT_WORKERS.
    workers = int(os.environ.get("SIGHTLINE_FIT_WORKERS", str(min(8, os.cpu_count() or 1))))
    connect = connection_factory()
    _log(f"Fitting simulation models on seasons {seasons} (REG), workers={workers}...")
    models = fit_simulation_models(connect, seasons, progress=_log, workers=workers)
    _log("assembly complete; fitting boosters and saving...")
    out = save_simulation_models(models)
    _log(f"Saved simulation-engine artefacts to {out}")
    for name in (_ENV_MODEL_FILE, _USAGE_MODEL_FILE, _EFFICIENCY_MODEL_FILE):
        p = out / name
        _log(f"  {name}: {p.stat().st_size} bytes")
    sys.stdout.flush()


if __name__ == "__main__":  # pragma: no cover - manual/scheduled entrypoint
    main()
