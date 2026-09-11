"""The live production path for the Simulation Engine (SIG-71).

``project_live.run_project`` is the manual/scheduled recompute that computes and
persists projections for contract-listed players. Until this module, every stat
type ran the per-player baseline engine. Now the active model per stat type is a
data fact — the ``model_selections`` table — read once per run and used to route:

* a stat type whose active ``model_version`` is the baseline (``baseline-zil-0.1.0``)
  keeps running ``project_one`` unchanged, per player;
* a stat type whose active ``model_version`` is the simulation engine
  (``simulation-mc-0.1.0``) is projected by the joint, per-game
  :func:`~sightline_model.simulation.core.simulate_game`.

Because the simulation is inherently per-game (its whole point is joint,
correlated draws under one seed), the routing groups the run's contract-listed
players by game: a game with ANY simulation-routed stat is simulated ONCE, and
every simulation-routed stat for every participating player is read off that one
run. The baseline-routed stats for the same game continue through the unchanged
per-player path in :mod:`sightline_model.project_live`.

What this module persists for one simulated game/cutoff, idempotently:

* ``projections`` + ``projection_drivers`` for each projected (player, stat),
  keyed by the same deterministic ``projection_row_id`` the baseline uses, so a
  re-run at the same cutoff upserts and never duplicates;
* ``projection_declines`` for insufficient-evidence declines (RD-4), so the
  application can show "insufficient evidence to project" distinctly from "no
  projection yet";
* one ``game_simulations`` row (seed, draw count, model version, cutoff) and its
  ``player_outcome_correlations`` rows from ``compute_correlations`` (RD-2:
  produced and stored, never consumed by sizing here).

All writes go through the sanctioned direct connection, inside the caller's
per-game transaction, so a game either fully persists or rolls back with the rest
of its stats. No price, recommendation, or edge is imported; the import-graph
guard sweeps this module.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sightline_ingest.asof import AsOfCorpus

from .. import artifacts as art

from ..stat_types import spec
from .config import (
    DISCRETE_STAT_TYPES,
    DRAW_COUNT,
    SIMULATION_MODEL_VERSION,
    pmf_support,
)
from .core import (
    CorrelationRecord,
    GameSimulationResult,
    PlayerSimInput,
    SimulatedProjection,
    simulate_game,
)
from .efficiency import EfficiencyHistory, EfficiencyModel
from .game_environment import (
    GameEnvironmentModel,
    assemble_game_environment_features,
)
from .usage_allocation import (
    UsageAllocationModel,
    allocate_shares,
    assemble_usage_features,
)

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # RFC 4122 URL namespace

# ``derive_seed`` returns a full unsigned 64-bit value (blake2b digest_size=8),
# which the RNG consumes directly. Postgres ``BIGINT`` is SIGNED 64-bit, so the
# top bit overflows it. The stored seed is provenance only (it is never read back
# to re-seed — the row's identity is (game, version, cutoff), and the RNG re-runs
# from ``derive_seed``), so we mask the sign bit for storage exactly as the
# backtest masks its stored run seed. Determinism is unaffected: the RNG still
# seeds from the full value inside ``simulate_game``.
_SIGNED_BIGINT_MASK = 0x7FFFFFFFFFFFFFFF


def _storable_seed(seed: int) -> int:
    """The derived seed masked into the non-negative signed-BIGINT range."""
    return int(seed) & _SIGNED_BIGINT_MASK

# The stat types the simulation engine can store. A ModelSelection pointing a
# stat type outside this set at the simulation version would be a data error; the
# router guards against it so a mis-seeded row cannot silently drop a stat.
_SIM_STAT_TYPES = frozenset(DISCRETE_STAT_TYPES) | frozenset(
    ("passing_yards", "rushing_yards", "receiving_yards")
)

_MODEL_SELECTIONS_SQL = "select stat_type::text as stat_type, model_version from model_selections"

_INSERT_PROJECTION_SQL = """
    insert into projections (
        id, player_id, game_id, stat_type, model_version, distribution_kind,
        params, quantiles, pmf, projected_value, projected_median,
        interval_low, interval_high, confidence, n_eff,
        computed_at, information_cutoff
    ) values (
        %(id)s, %(player_id)s, %(game_id)s, %(stat_type)s, %(model_version)s,
        %(distribution_kind)s, %(params)s, %(quantiles)s, %(pmf)s,
        %(projected_value)s, %(projected_median)s, %(interval_low)s,
        %(interval_high)s, %(confidence)s, %(n_eff)s,
        %(computed_at)s, %(information_cutoff)s
    )
    -- provenance defaults to 'base' and joins the unique key (SIG-74), so a
    -- base projection never collides with an adjustment_shadow at the same cutoff.
    on conflict (player_id, game_id, stat_type, model_version, information_cutoff, provenance)
    do nothing
"""

_INSERT_DRIVER_SQL = """
    insert into projection_drivers (id, projection_id, rank, text)
    values (%(id)s, %(projection_id)s, %(rank)s, %(text)s)
    on conflict (projection_id, rank) do nothing
"""

_INSERT_DECLINE_SQL = """
    insert into projection_declines (
        id, player_id, game_id, stat_type, model_version, reason,
        information_cutoff, computed_at
    ) values (
        %(id)s, %(player_id)s, %(game_id)s, %(stat_type)s, %(model_version)s,
        %(reason)s, %(information_cutoff)s, %(computed_at)s
    )
    on conflict (player_id, game_id, stat_type, model_version, information_cutoff)
    do nothing
"""

_INSERT_GAME_SIMULATION_SQL = """
    insert into game_simulations (
        id, game_id, model_version, information_cutoff, computed_at,
        seed, draw_count
    ) values (
        %(id)s, %(game_id)s, %(model_version)s, %(information_cutoff)s,
        %(computed_at)s, %(seed)s, %(draw_count)s
    )
    on conflict (game_id, model_version, information_cutoff) do nothing
"""

_INSERT_CORRELATION_SQL = """
    insert into player_outcome_correlations (
        id, game_simulation_id, player_a_id, stat_a, player_b_id, stat_b,
        method, correlation
    ) values (
        %(id)s, %(game_simulation_id)s, %(player_a_id)s, %(stat_a)s,
        %(player_b_id)s, %(stat_b)s, %(method)s, %(correlation)s
    )
    on conflict (game_simulation_id, player_a_id, stat_a, player_b_id, stat_b)
    do nothing
"""


@dataclass(frozen=True)
class SimulationModels:
    """The three fitted layer models the live engine reads.

    Fitting is a human-run offline step (SIG-67/68/69); the live path is handed
    already-fitted models loaded from local disk, exactly as the backtest is.
    Bundling them keeps the run signature honest about its three inputs. This is
    the same shape as :class:`sightline_model.simulation.backtest.SimulationModels`,
    defined here independently so the live path never imports the backtest module
    (which imports the walled-off grading corpus).
    """

    game_environment: "GameEnvironmentModel"
    usage: "UsageAllocationModel"
    efficiency: "EfficiencyModel"


# Conventional filenames for the three fitted artefacts under the models dir.
_ENV_MODEL_FILE = "game_environment.joblib"
_USAGE_MODEL_FILE = "usage_allocation.joblib"
_EFFICIENCY_MODEL_FILE = "efficiency.joblib"


def default_models_dir() -> Path:
    """The directory the fitted simulation artefacts live in.

    Overridable by ``SIGHTLINE_SIM_MODELS_DIR`` for a scheduled job that stages
    them elsewhere; defaults to ``python/artifacts/simulation-models``, alongside
    the (git-ignored, never-served) backtest artefacts. Fitting writes them there
    as a human-run offline step; the live path only ever reads them.
    """
    override = os.environ.get("SIGHTLINE_SIM_MODELS_DIR")
    if override:
        return Path(override)
    return art.default_artifact_base() / "simulation-models"


def load_simulation_models(models_dir: Path | None = None) -> SimulationModels:
    """Load the three fitted layer models from local disk.

    Mirrors the backtest's "handed already-fitted models" contract, resolved for
    production from a directory of artefacts rather than fit in-process. Raises a
    clear error if an artefact is missing rather than running the simulation
    engine on an unfitted model — an ingest/fit failure must be explicit.
    """
    base = Path(models_dir) if models_dir is not None else default_models_dir()
    return SimulationModels(
        game_environment=GameEnvironmentModel.load(base / _ENV_MODEL_FILE),
        usage=UsageAllocationModel.load(base / _USAGE_MODEL_FILE),
        efficiency=EfficiencyModel.load(base / _EFFICIENCY_MODEL_FILE),
    )


def load_model_selections(conn) -> dict[str, str]:
    """Read the ``model_selections`` registry → ``{stat_type: model_version}``.

    One read per run through the sanctioned direct connection. Six rows, so a
    plain fetch is correct; there is no cache to invalidate because the run is a
    single batch invocation, not a request path.
    """
    with conn.cursor() as cur:
        cur.execute(_MODEL_SELECTIONS_SQL)
        return {row[0]: row[1] for row in cur.fetchall()}


def simulation_stats(
    selections: dict[str, str], candidate_stats: set[str]
) -> list[str]:
    """The subset of ``candidate_stats`` routed to the simulation engine.

    A stat is simulation-routed iff its ``ModelSelection`` names the simulation
    model version. A selection that names the simulation version for a stat the
    engine cannot store is refused loudly rather than silently dropped — that is a
    mis-seeded registry, not a run condition to paper over.

    Retained for callers that still reason about the ACTIVE routing (e.g. the
    promotion tooling and its tests). The live pipeline now runs BOTH engines in
    parallel (SIG-103) and selects the simulation-supported stats with
    :func:`supported_simulation_stats`, independent of which engine is active.
    """
    out: list[str] = []
    for stat_type in sorted(candidate_stats):
        if selections.get(stat_type) == SIMULATION_MODEL_VERSION:
            if stat_type not in _SIM_STAT_TYPES:
                raise ValueError(
                    f"model_selections routes {stat_type!r} to the simulation "
                    f"engine, which cannot store that stat type"
                )
            out.append(stat_type)
    return out


def supported_simulation_stats(candidate_stats: set[str]) -> list[str]:
    """The subset of ``candidate_stats`` the simulation engine can produce.

    Parallel shadow evaluation (SIG-103) runs the simulation engine for every
    stat it *supports*, not merely the stats it is *active* for: whichever engine
    is not the active model must keep accruing comparable live projection history
    so Sightline can learn how it would have performed on the exact games the
    other engine was active for (spec §Core concepts, shadow evaluation). A stat
    outside the engine's storable set is simply not simulated — that is the
    baseline's job, and missing simulation support for a stat must never block
    the baseline (spec §Testing Priority 3).
    """
    return sorted(stat for stat in candidate_stats if stat in _SIM_STAT_TYPES)


def game_simulation_row_id(
    game_id: str, model_version: str, cutoff: datetime
) -> str:
    """Deterministic id for the ``game_simulations`` metadata row.

    uuid5 over the compound unique key so a re-run at the same cutoff collides on
    the same row rather than inserting a duplicate under a fresh random id.
    """
    key = f"sightline:game_simulation:{game_id}:{model_version}:{cutoff.isoformat()}"
    return str(uuid.uuid5(_NS, key))


def _correlation_row_id(game_simulation_id: str, record: CorrelationRecord) -> str:
    key = (
        f"sightline:correlation:{game_simulation_id}:"
        f"{record.player_a}:{record.stat_a}:{record.player_b}:{record.stat_b}"
    )
    return str(uuid.uuid5(_NS, key))


def _decline_row_id(
    player_id: str, game_id: str, stat_type: str, model_version: str, cutoff: datetime
) -> str:
    key = (
        f"sightline:projection_decline:{player_id}:{game_id}:{stat_type}:"
        f"{model_version}:{cutoff.isoformat()}"
    )
    return str(uuid.uuid5(_NS, key))


def _projection_row_id(
    player_id: str, game_id: str, stat_type: str, model_version: str, cutoff: datetime
) -> str:
    key = (
        f"sightline:projection:{player_id}:{game_id}:{stat_type}:"
        f"{model_version}:{cutoff.isoformat()}"
    )
    return str(uuid.uuid5(_NS, key))


def project_game_simulation(
    conn,
    corpus: AsOfCorpus,
    *,
    game: dict,
    game_id: str,
    stat_names: list[str],
    player_ids_by_stat: dict[str, list[str]],
    seasons_by_game: dict[str, int],
    cutoff: datetime,
    computed_at: datetime,
    models: SimulationModels,
    draw_count: int = DRAW_COUNT,
) -> dict[str, int]:
    """Simulate one game jointly and persist all simulation outputs.

    Runs inside the caller's per-game transaction (``project_live`` opens one per
    game), so the projections, drivers, declines, the ``game_simulations`` row,
    and its correlations either all persist or all roll back together.

    ``stat_names`` are the simulation-routed stats for this game;
    ``player_ids_by_stat`` maps each to the contract-listed players requesting it.
    The candidate universe is the union across those stats — a player requesting
    ANY simulation stat participates in the one joint run, and every simulation
    stat he can produce is stored.

    Returns per-outcome counts (``projected``, ``declined``, ``correlations``)
    for the run summary.
    """
    result = _simulate(
        corpus,
        game=game,
        game_id=game_id,
        stat_names=stat_names,
        player_ids_by_stat=player_ids_by_stat,
        cutoff=cutoff,
        computed_at=computed_at,
        models=models,
        draw_count=draw_count,
    )
    return _persist(conn, result, cutoff=cutoff, computed_at=computed_at)


def simulate_game_adjusted(
    corpus: AsOfCorpus,
    *,
    game: dict,
    game_id: str,
    stat_names: list[str],
    player_ids_by_stat: dict[str, list[str]],
    cutoff: datetime,
    computed_at: datetime,
    models: SimulationModels,
    unavailable_player_ids: frozenset[str],
    draw_count: int = DRAW_COUNT,
) -> GameSimulationResult:
    """Simulate one game with an extra set of players forced UNAVAILABLE.

    The Adjustment Suggestions engine (SIG-75) uses this to compute a
    *shadow* projection: what the game looks like if, say, ESPN's reported
    inactive really sits out. It shares every point-in-time discipline of the
    base path — all reads go through the cutoff-bound ``AsOfCorpus`` — and does
    NOT persist; the engine writes the shadows itself with
    ``provenance='adjustment_shadow'``. The availability override is applied on
    top of the as-of injury designation, never instead of it: a player already
    out stays out.
    """
    return _simulate(
        corpus,
        game=game,
        game_id=game_id,
        stat_names=stat_names,
        player_ids_by_stat=player_ids_by_stat,
        cutoff=cutoff,
        computed_at=computed_at,
        models=models,
        draw_count=draw_count,
        unavailable_player_ids=unavailable_player_ids,
    )


def _simulate(
    corpus: AsOfCorpus,
    *,
    game: dict,
    game_id: str,
    stat_names: list[str],
    player_ids_by_stat: dict[str, list[str]],
    cutoff: datetime,
    computed_at: datetime,
    models: SimulationModels,
    draw_count: int,
    unavailable_player_ids: frozenset[str] = frozenset(),
) -> GameSimulationResult:
    """Assemble Layers 1-3 as-of and run the joint simulation for one game.

    Point-in-time discipline is inherited: every read is against the cutoff-bound
    ``AsOfCorpus``, exactly as the backtest path reads. The only difference from
    the backtest is the candidate universe — here it is the contract-listed
    players requesting a simulation-routed stat, not the full pre-cutoff
    participation universe.
    """
    home, away = game["home_abbr"], game["away_abbr"]
    requested_players = sorted(
        {pid for players in player_ids_by_stat.values() for pid in players}
    )

    # --- Layer 1: game environment (as-of) --------------------------------
    env_features = assemble_game_environment_features(
        corpus,
        game_id=game_id,
        home_team_abbr=home,
        away_team_abbr=away,
        is_dome=bool(game.get("is_dome")),
    )
    environment_pred = models.game_environment.predict(env_features)

    # --- Positions from as-of participation (never the target game itself) --
    positions: dict[str, str | None] = {}
    for stat_name in stat_names:
        stat = spec(stat_name)
        participants = corpus.season_participants(
            seasons=(game["season"] - 1, game["season"]), column=stat.column
        )
        for row in participants.to_dicts():
            positions.setdefault(row["player_id"], row["position"])

    # --- Layer 2: usage allocation per team (as-of) ------------------------
    usage_by_team: dict[str, dict[str, dict[str, float]]] = {}
    usage_features = {
        team: assemble_usage_features(
            corpus,
            game_id=game_id,
            team_abbr=team,
            player_ids=sorted(positions) or requested_players,
            positions=positions,
        )
        for team in (home, away)
    }
    team_of: dict[str, str] = {}
    for team in (home, away):
        feats = {
            pid: f for pid, f in usage_features[team].items() if f.team_abbr == team
        }
        scores = models.usage.predict(feats) if feats else {}
        # The adjustment override forces the reported inactive to unavailable ON
        # TOP OF his as-of injury designation — never re-enabling a player the
        # corpus already knows is out. His freed usage renormalises structurally
        # over available teammates inside allocate_shares (SIG-75).
        available = {
            pid: (feats[pid].is_available and pid not in unavailable_player_ids)
            for pid in feats
        }
        shares = allocate_shares(scores, available)
        usage_by_team[team] = {
            "target_shares": {pid: s["target_share"] for pid, s in shares.items()},
            "carry_shares": {pid: s["carry_share"] for pid, s in shares.items()},
        }
        for pid in feats:
            team_of[pid] = team

    # --- Layer 3: efficiency, then the joint run over requested players -----
    trailing = corpus.trailing_player_stats_batch(
        player_ids=requested_players, before_game_id=game_id
    )
    grouped: dict[str, list[dict]] = {pid: [] for pid in requested_players}
    if trailing.height:
        for r in trailing.sort("player_id", "kickoff_at").to_dicts():
            if r["player_id"] in grouped:
                grouped[r["player_id"]].append(r)

    sim_players: list[PlayerSimInput] = []
    for pid in requested_players:
        # A requested player only enters the joint run for stats he requested and
        # under the team his as-of usage assigned him to. A player with no as-of
        # team (never seen before cutoff) is placed on his contract's game team by
        # falling back to whichever side lists him; if neither does, he simply
        # produces zeros — never fabricated evidence.
        team = team_of.get(pid) or home
        requested = tuple(
            s for s in stat_names if pid in set(player_ids_by_stat.get(s, []))
        )
        if not requested:
            continue
        history = _efficiency_history(pid, positions.get(pid), grouped[pid])
        efficiency = models.efficiency.predict(history)
        sim_players.append(
            PlayerSimInput(
                player_id=pid,
                team_abbr=team,
                position=positions.get(pid),
                efficiency=efficiency,
                n_eff=history.n_eff,
                requested_stats=requested,
            )
        )

    return simulate_game(
        game_id=game_id,
        information_cutoff=cutoff,
        environment_pred=environment_pred,
        usage_by_team=usage_by_team,
        players=sim_players,
        computed_at=computed_at,
        draw_count=draw_count,
    )


def _efficiency_history(
    player_id: str, position: str | None, rows: list[dict]
) -> EfficiencyHistory:
    """Trailing per-opportunity efficiency from as-of corpus rows.

    Identical reduction to the backtest path: per-opportunity ratios of the
    player's own windowed totals, never a season aggregate, absent channels left
    ``None`` so the efficiency model falls back to the position prior.
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


def _persist(
    conn, result: GameSimulationResult, *, cutoff: datetime, computed_at: datetime
) -> dict[str, int]:
    """Persist every simulation output for the game, idempotently.

    Deterministic ids on the compound unique keys mean every write is an upsert:
    a re-run at the same cutoff inserts nothing and changes nothing. The whole
    thing runs in the caller's transaction so a partial write is impossible.
    """
    counts = {"projected": 0, "declined": 0, "correlations": 0}

    with conn.cursor() as cur:
        for projection in result.projections:
            counts["projected"] += _persist_projection(
                cur, projection, cutoff=cutoff, computed_at=computed_at
            )
        for decline in result.declines:
            row_id = _decline_row_id(
                decline.player_id,
                result.game_id,
                decline.stat_type,
                SIMULATION_MODEL_VERSION,
                cutoff,
            )
            cur.execute(
                _INSERT_DECLINE_SQL,
                {
                    "id": row_id,
                    "player_id": decline.player_id,
                    "game_id": result.game_id,
                    "stat_type": decline.stat_type,
                    "model_version": SIMULATION_MODEL_VERSION,
                    "reason": decline.reason,
                    "information_cutoff": cutoff,
                    "computed_at": computed_at,
                },
            )
            counts["declined"] += 1

        gs_id = game_simulation_row_id(
            result.game_id, SIMULATION_MODEL_VERSION, cutoff
        )
        cur.execute(
            _INSERT_GAME_SIMULATION_SQL,
            {
                "id": gs_id,
                "game_id": result.game_id,
                "model_version": SIMULATION_MODEL_VERSION,
                "information_cutoff": cutoff,
                "computed_at": computed_at,
                "seed": _storable_seed(result.seed),
                "draw_count": int(result.draw_count),
            },
        )
        for record in result.correlations:
            cur.execute(
                _INSERT_CORRELATION_SQL,
                {
                    "id": _correlation_row_id(gs_id, record),
                    "game_simulation_id": gs_id,
                    "player_a_id": record.player_a,
                    "stat_a": record.stat_a,
                    "player_b_id": record.player_b,
                    "stat_b": record.stat_b,
                    "method": "spearman",
                    "correlation": record.correlation,
                },
            )
            counts["correlations"] += 1

    return counts


def _persist_projection(
    cur, projection: SimulatedProjection, *, cutoff: datetime, computed_at: datetime
) -> int:
    """Insert one simulation projection + its drivers; 1 if inserted else 0."""
    row_id = _projection_row_id(
        projection.player_id,
        projection.game_id,
        projection.stat_type,
        projection.model_version,
        cutoff,
    )
    cur.execute(
        _INSERT_PROJECTION_SQL,
        {
            "id": row_id,
            "player_id": projection.player_id,
            "game_id": projection.game_id,
            "stat_type": projection.stat_type,
            "model_version": projection.model_version,
            "distribution_kind": projection.distribution_kind,
            "params": json.dumps(projection.params),
            "quantiles": json.dumps(projection.quantiles)
            if projection.quantiles is not None
            else None,
            "pmf": json.dumps(projection.pmf) if projection.pmf is not None else None,
            "projected_value": projection.projected_value,
            "projected_median": projection.projected_median,
            "interval_low": projection.interval_low,
            "interval_high": projection.interval_high,
            "confidence": projection.confidence,
            "n_eff": projection.n_eff,
            "computed_at": computed_at,
            "information_cutoff": cutoff,
        },
    )
    # ON CONFLICT DO NOTHING: an existing row for this key keeps its drivers too.
    if cur.rowcount == 0:
        return 0
    for rank, text in enumerate(projection.drivers):
        cur.execute(
            _INSERT_DRIVER_SQL,
            {
                "id": str(uuid.uuid5(_NS, f"sightline:driver:{row_id}:{rank}")),
                "projection_id": row_id,
                "rank": rank,
                "text": text,
            },
        )
    return 1
