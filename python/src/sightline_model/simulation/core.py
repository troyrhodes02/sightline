"""The vectorised joint game simulation — the Simulation Engine's core.

This is the module that composes the three layers into a single seeded run and
produces every participating player's full stat line **jointly, per game**. It
is the most important module in the pitch: reproducibility, vectorisation, and
joint structure are invariants here, not nice-to-haves.

The shape of one run (:func:`simulate_game`):

1. Seed one ``numpy.random.default_rng`` from ``derive_seed(game_id,
   model_version, information_cutoff)`` — a per-GAME seed, never per player, so
   the whole game is drawn from one stream and within-game correlation is real
   (R1/R2, RD-SIM-7).
2. ``sample_team_volumes`` (Layer 1) → each team's per-draw attempts.
3. ``sample_player_opportunities`` (Layer 2) → each player's per-draw targets and
   carries; the QB's pass attempts are the team's pass attempts.
4. The Layer 3 efficiency samplers → each player's per-draw stat line.

Every operation runs across a **single draw axis of length ``draw_count``**,
with no Python loop over draws — the vectorisation the Definition of Done
requires and the tests assert against source.

From the per-player, per-stat draw arrays it derives the same compact
distribution the baseline stores — a 9-point empirical quantile grid for
yardage, an explicit PMF (0..K plus a (K+1)+ tail) for counts — and then
**discards the raw draws**. Correlations among the projected marginals are
computed from the draws *before* they are discarded, and returned as a compact
list of records (persistence to ``GameSimulation`` / ``PlayerOutcomeCorrelation``
is SIG-71).

Confidence is ordinal (high/medium/low, the baseline's bands) and is driven by
the player's relevant role-history depth and the distribution's relative width —
**never by the draw count**. A player with zero relevant opportunity as of the
cutoff yields a :class:`~sightline_model.projection.Unprojectable` decline
(reason ``insufficient_evidence``), not a fabricated distribution.

No price, recommendation, or edge is imported here; the import-graph guard
sweeps this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from ..constants import CONFIDENCE_BANDS, MIN_HISTORY_FOR_MEDIUM, N_FOR_HIGH
from ..projection import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    Unprojectable,
)
from ..stat_types import FAMILY_CONTINUOUS, FAMILY_COUNT
from .config import (
    CONTINUOUS_STAT_TYPES,
    DISCRETE_STAT_TYPES,
    DISTRIBUTION_KIND_PMF,
    DISTRIBUTION_KIND_QUANTILES,
    DRAW_COUNT,
    EVIDENCE_FLOOR_OPPORTUNITIES,
    QUANTILE_GRID,
    SIMULATION_MODEL_VERSION,
    pmf_support,
)
from .efficiency import (
    PlayerEfficiency,
    sample_passing,
    sample_receiving,
    sample_rushing,
)
from .game_environment import GameEnvironmentPrediction, sample_team_volumes
from .seed import derive_seed
from .usage_allocation import sample_player_opportunities

REASON_INSUFFICIENT_EVIDENCE = "insufficient_evidence"

# The reduction each stat type's draws collapse to. Yardage → quantile grid;
# counts → explicit PMF. Derived once from the config so the two lists stay the
# single source of truth.
_QUANTILE_STATS = frozenset(CONTINUOUS_STAT_TYPES)
_PMF_STATS = frozenset(DISCRETE_STAT_TYPES)

# The draw keys each channel's sampler emits, so the core can iterate stat types
# without re-deriving which sampler owns which stat.
_RECEIVING_STATS = ("receiving_yards", "receptions", "receiving_tds")
_RUSHING_STATS = ("rushing_yards", "rushing_tds")
_PASSING_STATS = ("passing_yards", "passing_tds")


# ---------------------------------------------------------------------------
# Inputs and outputs.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PlayerSimInput:
    """Everything the core needs about one player to simulate his line.

    ``team_abbr`` places him under a team's volume; ``position`` selects which
    channels he participates in (a QB passes, a RB rushes and receives, a WR/TE
    receives). ``efficiency`` is his Layer-3 parameters; ``n_eff`` is his
    relevant role-history depth (the confidence input, and the evidence-floor
    gate). ``requested_stats`` names the stat types to project for him —
    typically the ones with a live Kalshi contract; the core projects exactly
    those he can produce.
    """

    player_id: str
    team_abbr: str
    position: str | None
    efficiency: PlayerEfficiency
    n_eff: int
    requested_stats: tuple[str, ...]


@dataclass(frozen=True)
class SimulatedProjection:
    """One player, one stat, one game — the compact distribution plus provenance.

    Mirrors the baseline :class:`~sightline_model.projection.ProjectionResult`
    contract closely enough that the harness and the persistence layer treat the
    two engines uniformly, differing only in the empirical ``distribution_kind``
    and the fact that a count family additionally carries an explicit ``pmf``
    (``quantiles`` is always populated, matching the baseline).
    """

    player_id: str
    game_id: str
    stat_type: str
    model_version: str

    distribution_kind: str
    params: dict[str, float]
    quantiles: dict[str, float] | None
    pmf: list[float] | None

    projected_value: float
    projected_median: float
    interval_low: float
    interval_high: float

    confidence: str
    n_eff: int

    drivers: list[str]
    computed_at: datetime
    information_cutoff: datetime


@dataclass(frozen=True)
class CorrelationRecord:
    """One pairwise Spearman correlation among two projected marginals."""

    player_a: str
    stat_a: str
    player_b: str
    stat_b: str
    correlation: float


@dataclass(frozen=True)
class GameSimulationResult:
    """The full output of one seeded joint game simulation.

    ``projections`` and ``declines`` partition the requested (player, stat) pairs;
    ``correlations`` are the pairwise Spearman correlations among the projected
    marginals, computed from the draws before they were discarded. ``seed`` and
    ``draw_count`` are carried so the persistence layer (SIG-71) can write the
    ``GameSimulation`` metadata row without re-deriving them.
    """

    game_id: str
    model_version: str
    information_cutoff: datetime
    computed_at: datetime
    seed: int
    draw_count: int
    projections: list[SimulatedProjection]
    declines: list[Unprojectable]
    correlations: list[CorrelationRecord] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Compact distribution derivation (R4 — deterministic, order-independent).
# ---------------------------------------------------------------------------


def to_quantile_grid(draws: np.ndarray) -> dict[str, float]:
    """The 9-point empirical quantile grid over the fixed :data:`QUANTILE_GRID`.

    ``numpy.quantile`` with the default linear method is a fixed, order-independent
    reduction: the same draw array always yields the same grid, byte-for-byte
    once serialised (R3/R4). Keys are ``q01..q99`` matching the stored JSON shape.
    """
    values = np.quantile(np.asarray(draws, dtype=np.float64), QUANTILE_GRID)
    return {f"q{int(q * 100):02d}": float(v) for q, v in zip(QUANTILE_GRID, values)}


def to_pmf(draws: np.ndarray, k: int) -> list[float]:
    """Explicit PMF over ``0..k`` plus one aggregated ``(k+1)+`` tail bucket.

    Returns a length ``k + 2`` mass vector: index ``i`` is ``P(X = i)`` for
    ``0 <= i <= k`` and index ``k + 1`` is ``P(X >= k + 1)``. ``numpy.bincount``
    over the integer draws is a fixed, order-independent reduction (R4); the
    masses sum to 1 exactly (up to float), so ``P(>= t)`` is a tail sum.
    """
    counts = np.asarray(draws, dtype=np.int64)
    if counts.ndim != 1:
        raise ValueError("PMF draws must be one-dimensional")
    n = counts.shape[0]
    clipped = np.minimum(counts, k + 1)
    binned = np.bincount(clipped, minlength=k + 2)
    return [float(c) / n for c in binned[: k + 2]]


def _summary_params(draws: np.ndarray, *, include_sd: bool) -> dict[str, float]:
    """Inspection-only summary stats: mean, (sd), zeroMass. Not the distribution."""
    arr = np.asarray(draws, dtype=np.float64)
    params: dict[str, float] = {
        "mean": float(arr.mean()),
        "zeroMass": float(np.mean(arr <= 0.0)),
    }
    if include_sd:
        params["sd"] = float(arr.std(ddof=0))
    return params


# ---------------------------------------------------------------------------
# Threshold probability from the stored compact form (used by tests + the
# harness; the TS runtime carries the golden-parity twin in SIG-72).
# ---------------------------------------------------------------------------


def prob_at_least_from_quantiles(quantiles: dict[str, float], threshold: float) -> float:
    """``P(X >= t)`` by monotone piecewise-linear interpolation on the CDF.

    Builds the implied CDF from the stored ``(percentile, value)`` points and
    returns ``1 - CDF(t)``. Below the lowest stored value the CDF clamps toward 0
    (floored at value 0 for non-negative stats); above the highest it clamps
    toward 1. Ties are nudged to strict monotonicity before interpolation. This
    is the Python side of the cross-runtime golden parity (SIG-72 adds the TS
    twin and the fixture); here it lets the reproducibility test compare a
    grid-derived probability against the empirical draw fraction.
    """
    percentiles = np.array([q for q in QUANTILE_GRID], dtype=np.float64)
    values = np.array([quantiles[f"q{int(q * 100):02d}"] for q in QUANTILE_GRID], dtype=np.float64)
    # Nudge to strictly increasing so np.interp is well defined on ties.
    for i in range(1, values.size):
        if values[i] <= values[i - 1]:
            values[i] = values[i - 1] + 1e-9
    if threshold <= values[0]:
        # At or below the lowest stored quantile: CDF is at most percentiles[0].
        cdf = percentiles[0] if threshold >= values[0] else 0.0
    elif threshold >= values[-1]:
        cdf = 1.0
    else:
        cdf = float(np.interp(threshold, values, percentiles))
    return float(min(max(1.0 - cdf, 0.0), 1.0))


def prob_at_least_from_pmf(pmf: list[float], threshold: float) -> float:
    """``P(X >= t)`` = sum of PMF mass at indices ``>= ceil(t)``.

    The tail bucket (last index) contributes fully to any threshold that lands at
    or before it. Kalshi count thresholds are ``.5`` values, so ``ceil`` maps
    ``k.5`` to ``k + 1`` and never ties an integer support point.
    """
    k = int(np.ceil(threshold))
    if k <= 0:
        return 1.0
    if k >= len(pmf):
        # Past the last (K+1)+ tail bucket. Supported thresholds never reach here:
        # each stat's PMF support K is chosen so every listed Kalshi threshold has
        # ceil(t) <= K+1 (the tail index, len(pmf)-1), which the branch below sums.
        # An out-of-range threshold would need resolution the compact PMF discarded
        # into the tail; the residual mass beyond K+1 is negligible by construction,
        # so 0.0 is the intended value, not a fabricated one.
        return 0.0
    return float(sum(pmf[k:]))


# ---------------------------------------------------------------------------
# Confidence (ordinal; from role-history depth and relative width, NOT draws).
# ---------------------------------------------------------------------------


def _relative_width(family: str, projected: float, low: float, high: float) -> float:
    band = CONFIDENCE_BANDS[family]
    denominator = max(projected, band["floor"]) + band["offset"]
    if denominator <= 0.0:
        return float("inf")
    return (high - low) / denominator


def _confidence(family: str, n_eff: int, relative_width: float) -> str:
    """The baseline's ordinal rule, first match wins. Reused verbatim in spirit.

    Reads only ``n_eff`` (role-history depth) and the interval's relative width.
    The draw count appears nowhere: 5,000 draws and 20,000 draws produce the same
    ordinal label for the same player, which the sparse-data test asserts.
    """
    band = CONFIDENCE_BANDS[family]
    if n_eff < MIN_HISTORY_FOR_MEDIUM:
        return CONFIDENCE_LOW
    if relative_width > band["w_low"]:
        return CONFIDENCE_LOW
    if n_eff >= N_FOR_HIGH and relative_width <= band["w_high"]:
        return CONFIDENCE_HIGH
    return CONFIDENCE_MEDIUM


# ---------------------------------------------------------------------------
# Drivers (from actual layer outputs; never a value the sim did not use).
# ---------------------------------------------------------------------------


def _drivers(
    *,
    stat_type: str,
    player: PlayerSimInput,
    team_volume_mean: float,
    league_volume_ref: float,
    player_stat_mean: float,
) -> list[str]:
    """Three-to-five deterministic sentences from real layer outputs.

    Each names a quantity the simulation actually used: the team's expected game
    volume against a league reference (Layer 1), the player's role depth and the
    efficiency rate his channel used (Layer 3), and the projected mean of this
    stat. No football narration the model never consulted.
    """
    out: list[str] = []
    # Only emit the volume driver when the player's team was actually simulated.
    # A player whose resolved team is absent from the game's environment gets
    # team_volume_mean == 0; emitting "0 plays, 100% below the league" would be a
    # fabricated quantitative claim (the pitch's "driver theater" no-go), so we
    # omit the sentence rather than narrate a number the simulation did not use.
    if team_volume_mean > 0 and league_volume_ref > 0:
        delta = (team_volume_mean - league_volume_ref) / league_volume_ref * 100.0
        direction = "above" if delta >= 0 else "below"
        out.append(
            f"Expected team volume {team_volume_mean:.0f} plays, "
            f"{abs(delta):.0f}% {direction} the league reference of "
            f"{league_volume_ref:.0f}."
        )
    out.append(
        f"{player.n_eff} eligible role-history games establish the usage this "
        f"projection allocates opportunity from."
    )
    eff = player.efficiency
    rate = _channel_rate_sentence(stat_type, eff)
    if rate is not None:
        out.append(rate)
    out.append(
        f"Projected {stat_type.replace('_', ' ')} mean {player_stat_mean:.1f} "
        f"from the joint simulation."
    )
    return out


def _channel_rate_sentence(stat_type: str, eff: PlayerEfficiency) -> str | None:
    """The efficiency rate the stat's channel actually consumed, if any."""
    if stat_type in _RECEIVING_STATS:
        if stat_type == "receiving_yards" and eff.yards_per_target:
            return f"Receiving efficiency {eff.yards_per_target:.1f} yards per target."
        if stat_type == "receptions" and eff.catch_rate:
            return f"Catch rate {eff.catch_rate * 100:.0f}% of targets."
        if stat_type == "receiving_tds" and eff.rec_td_rate:
            return f"Receiving TD rate {eff.rec_td_rate * 100:.1f}% per target."
    if stat_type in _RUSHING_STATS:
        if stat_type == "rushing_yards" and eff.yards_per_carry:
            return f"Rushing efficiency {eff.yards_per_carry:.1f} yards per carry."
        if stat_type == "rushing_tds" and eff.rush_td_rate:
            return f"Rushing TD rate {eff.rush_td_rate * 100:.1f}% per carry."
    if stat_type in _PASSING_STATS:
        if stat_type == "passing_yards" and eff.yards_per_pass_attempt:
            return f"Passing efficiency {eff.yards_per_pass_attempt:.1f} yards per attempt."
        if stat_type == "passing_tds" and eff.pass_td_rate:
            return f"Passing TD rate {eff.pass_td_rate * 100:.1f}% per attempt."
    return None


# ---------------------------------------------------------------------------
# Joint outcomes (correlations among projected marginals, before draws vanish).
# ---------------------------------------------------------------------------


def _spearman_matrix(matrix: np.ndarray) -> np.ndarray:
    """Spearman rank correlation of the columns of ``matrix``, deterministically.

    Rank each column (average ties) then take the Pearson correlation of the
    ranks — the definition of Spearman. ``argsort`` is a fixed reduction over a
    fixed draw ordering, so the result is reproducible (R4).
    """
    ranks = np.apply_along_axis(_rankdata, 0, matrix)
    return np.corrcoef(ranks, rowvar=False)


def _rankdata(values: np.ndarray) -> np.ndarray:
    """Average-tie ranks of a 1-D array, deterministic and dependency-free."""
    order = np.argsort(values, kind="stable")
    ranks = np.empty(values.shape[0], dtype=np.float64)
    ranks[order] = np.arange(1, values.shape[0] + 1, dtype=np.float64)
    # Average ties so a constant column does not produce spurious rank spread.
    sorted_vals = values[order]
    i = 0
    n = values.shape[0]
    while i < n:
        j = i
        while j + 1 < n and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        if j > i:
            avg = (np.arange(i + 1, j + 2, dtype=np.float64)).mean()
            ranks[order[i : j + 1]] = avg
        i = j + 1
    return ranks


def compute_correlations(
    draws_by_marginal: dict[tuple[str, str], np.ndarray],
    *,
    method: str = "spearman",
) -> list[CorrelationRecord]:
    """Pairwise correlation among projected (player, stat) marginals.

    ``draws_by_marginal`` maps ``(player_id, stat_type)`` to that marginal's
    ``(draw_count,)`` draw array — the projected marginals only (bounded set,
    RD-SIM-4). Returns one :class:`CorrelationRecord` per unordered pair. A
    constant marginal (all-zero draws) correlates undefinedly with everything;
    ``numpy.corrcoef`` yields NaN there, which we drop rather than store, keeping
    every stored correlation a real number in [-1, 1].
    """
    if method != "spearman":
        raise ValueError(f"unsupported correlation method: {method!r}")
    keys = list(draws_by_marginal)
    if len(keys) < 2:
        return []
    matrix = np.column_stack([draws_by_marginal[k].astype(np.float64) for k in keys])
    corr = _spearman_matrix(matrix)
    out: list[CorrelationRecord] = []
    for a in range(len(keys)):
        for b in range(a + 1, len(keys)):
            value = corr[a, b]
            if not np.isfinite(value):
                continue
            (pa, sa), (pb, sb) = keys[a], keys[b]
            out.append(
                CorrelationRecord(
                    player_a=pa,
                    stat_a=sa,
                    player_b=pb,
                    stat_b=sb,
                    correlation=float(min(max(value, -1.0), 1.0)),
                )
            )
    return out


# ---------------------------------------------------------------------------
# The joint game simulation.
# ---------------------------------------------------------------------------


def simulate_game(
    *,
    game_id: str,
    information_cutoff: datetime,
    environment_pred: dict[str, GameEnvironmentPrediction],
    usage_by_team: dict[str, dict[str, dict[str, float]]],
    players: list[PlayerSimInput],
    efficiency_by_player: dict[str, PlayerEfficiency] | None = None,
    computed_at: datetime | None = None,
    rng: np.random.Generator | None = None,
    draw_count: int = DRAW_COUNT,
) -> GameSimulationResult:
    """Simulate every participating player's stat line jointly, in one seeded run.

    ``environment_pred`` is Layer 1's per-team ``GameEnvironmentPrediction``;
    ``usage_by_team`` maps ``team_abbr -> {target_shares, carry_shares}`` (each a
    ``{player_id -> share}`` dict including ``__replacement__``) from Layer 2's
    ``allocate_shares``; ``players`` are the participating players with their
    Layer-3 efficiency and role-history depth. If ``rng`` is None it is built from
    ``derive_seed(game_id, SIMULATION_MODEL_VERSION, information_cutoff)`` — a
    per-game seed, so two calls with the same identity reproduce byte-identically
    (R3). ``draw_count`` is the single vectorised draw axis; there is no Python
    loop over draws anywhere below.

    Each participating player with at least :data:`EVIDENCE_FLOOR_OPPORTUNITIES`
    relevant role-history games yields a :class:`SimulatedProjection` per
    requested stat he can produce; a player below the floor yields a single
    :class:`Unprojectable` decline (``insufficient_evidence``) rather than a
    fabricated distribution. Correlations among the projected marginals are
    computed from the draws, then the raw draws are discarded.
    """
    if draw_count <= 0:
        raise ValueError("draw_count must be positive")
    if computed_at is None:
        computed_at = datetime.now()
    if rng is None:
        seed = derive_seed(game_id, SIMULATION_MODEL_VERSION, information_cutoff)
        rng = np.random.default_rng(seed)
    else:
        # A caller-supplied rng carries no derivable seed; record the derived one
        # for the metadata row regardless, so provenance is stable.
        seed = derive_seed(game_id, SIMULATION_MODEL_VERSION, information_cutoff)

    if efficiency_by_player:
        players = [
            PlayerSimInput(
                player_id=p.player_id,
                team_abbr=p.team_abbr,
                position=p.position,
                efficiency=efficiency_by_player.get(p.player_id, p.efficiency),
                n_eff=p.n_eff,
                requested_stats=p.requested_stats,
            )
            for p in players
        ]

    # --- Layer 1: team volumes (single draw axis, shared latents) ----------
    team_volumes = sample_team_volumes(rng, environment_pred, draw_count)
    # sample_team_volumes returns total attempts per team. Split into pass/rush
    # per draw using the predicted mean ratio (deterministic, no extra RNG): the
    # split proportion is a property of the environment prediction, and the pace
    # latent already scaled the total.
    pass_by_team: dict[str, np.ndarray] = {}
    rush_by_team: dict[str, np.ndarray] = {}
    for team_abbr, total in team_volumes.items():
        pred = environment_pred[team_abbr]
        denom = pred.pass_attempts_mean + pred.rush_attempts_mean
        pass_frac = pred.pass_attempts_mean / denom if denom > 0 else 0.5
        pass_att = np.rint(total * pass_frac).astype(np.int64)
        rush_att = (total.astype(np.int64) - pass_att).clip(min=0)
        pass_by_team[team_abbr] = pass_att
        rush_by_team[team_abbr] = rush_att

    # --- Layer 2: per-player opportunity counts, per team ------------------
    opportunities: dict[str, dict[str, np.ndarray]] = {}
    for team_abbr, shares in usage_by_team.items():
        if team_abbr not in pass_by_team:
            continue
        drawn = sample_player_opportunities(
            rng,
            pass_attempts=pass_by_team[team_abbr],
            rush_attempts=rush_by_team[team_abbr],
            target_shares=shares["target_shares"],
            carry_shares=shares["carry_shares"],
            draw_count=draw_count,
        )
        opportunities.update(drawn)

    # --- Layer 3: per-player stat lines, then reduce to compact form -------
    projections: list[SimulatedProjection] = []
    declines: list[Unprojectable] = []
    draws_by_marginal: dict[tuple[str, str], np.ndarray] = {}

    league_volume_ref = _league_volume_reference(environment_pred)

    for player in players:
        if player.n_eff < EVIDENCE_FLOOR_OPPORTUNITIES:
            # Zero relevant opportunity is not a wide projection, it is a decline
            # for every requested stat (RD-4).
            for stat_type in player.requested_stats:
                declines.append(
                    Unprojectable(
                        player_id=player.player_id,
                        game_id=game_id,
                        stat_type=stat_type,
                        reason=REASON_INSUFFICIENT_EVIDENCE,
                        information_cutoff=information_cutoff,
                        n_eff=player.n_eff,
                    )
                )
            continue

        stat_draws = _player_stat_draws(
            rng,
            player=player,
            opportunities=opportunities.get(player.player_id, {}),
            pass_attempts=pass_by_team.get(player.team_abbr),
            draw_count=draw_count,
        )
        team_volume_mean = float(team_volumes[player.team_abbr].mean()) if player.team_abbr in team_volumes else 0.0

        for stat_type in player.requested_stats:
            if stat_type not in _QUANTILE_STATS and stat_type not in _PMF_STATS:
                # Not a stored (Kalshi-listed) stat type. The efficiency layer
                # emits channel outputs like passing_tds that are not projected
                # in this pitch; a request for one is ignored, not an error.
                continue
            draws = stat_draws.get(stat_type)
            if draws is None:
                # A requested stat the player's position cannot produce (a WR
                # asked for passing_yards); silently omitted, not declined —
                # decline is reserved for the evidence floor.
                continue
            draws_by_marginal[(player.player_id, stat_type)] = draws
            projections.append(
                _build_projection(
                    game_id=game_id,
                    player=player,
                    stat_type=stat_type,
                    draws=draws,
                    team_volume_mean=team_volume_mean,
                    league_volume_ref=league_volume_ref,
                    computed_at=computed_at,
                    information_cutoff=information_cutoff,
                )
            )

    correlations = compute_correlations(draws_by_marginal, method="spearman")
    # Raw draws are discarded here: nothing below this line references them.
    return GameSimulationResult(
        game_id=game_id,
        model_version=SIMULATION_MODEL_VERSION,
        information_cutoff=information_cutoff,
        computed_at=computed_at,
        seed=seed,
        draw_count=draw_count,
        projections=projections,
        declines=declines,
        correlations=correlations,
    )


def _league_volume_reference(environment_pred: dict[str, GameEnvironmentPrediction]) -> float:
    """A within-game league reference: the mean team volume across the two teams."""
    totals = [p.pass_attempts_mean + p.rush_attempts_mean for p in environment_pred.values()]
    return float(np.mean(totals)) if totals else 0.0


def _player_stat_draws(
    rng: np.random.Generator,
    *,
    player: PlayerSimInput,
    opportunities: dict[str, np.ndarray],
    pass_attempts: np.ndarray | None,
    draw_count: int,
) -> dict[str, np.ndarray]:
    """The player's per-stat draw arrays, from his channels' efficiency samplers.

    A player receives (targets) and rushes (carries) via Layer 2's opportunity
    draws; a quarterback additionally passes the team's pass attempts. Which
    channels fire is a function of position and available opportunity, not a
    hand-authored roster — a RB with zero carries in a draw simply produces zero
    rushing yards there.
    """
    out: dict[str, np.ndarray] = {}
    targets = opportunities.get("targets")
    carries = opportunities.get("carries")

    if targets is not None:
        rec = sample_receiving(rng, targets=targets, efficiency=player.efficiency, draw_count=draw_count)
        out.update(rec)
    if carries is not None:
        rush = sample_rushing(rng, carries=carries, efficiency=player.efficiency, draw_count=draw_count)
        out.update(rush)
    if _is_passer(player) and pass_attempts is not None:
        passing = sample_passing(
            rng, pass_attempts=pass_attempts, efficiency=player.efficiency, draw_count=draw_count
        )
        out.update(passing)
    return out


def _is_passer(player: PlayerSimInput) -> bool:
    """Whether the player throws — the QB. V1: one passer per team, by position."""
    return (player.position or "").upper() == "QB"


def _build_projection(
    *,
    game_id: str,
    player: PlayerSimInput,
    stat_type: str,
    draws: np.ndarray,
    team_volume_mean: float,
    league_volume_ref: float,
    computed_at: datetime,
    information_cutoff: datetime,
) -> SimulatedProjection:
    """Reduce one stat's draws to the compact stored form + confidence + drivers.

    Family (and therefore quantile-grid vs PMF) is decided by config membership,
    not the stat registry: the efficiency layer can produce a channel output
    (``passing_tds``) that is not one of the six Kalshi-listed stat types, and
    only listed continuous/discrete stats are ever requested for storage.
    """
    projected_value = float(np.asarray(draws, dtype=np.float64).mean())

    if stat_type in _QUANTILE_STATS:
        quantiles = to_quantile_grid(draws)
        pmf = None
        params = _summary_params(draws, include_sd=True)
        projected_median = quantiles["q50"]
        low, high = quantiles["q10"], quantiles["q90"]
        distribution_kind = DISTRIBUTION_KIND_QUANTILES
        family = FAMILY_CONTINUOUS
    else:
        k = pmf_support(stat_type)
        pmf = to_pmf(draws, k)
        # A count family is stored as an explicit PMF (the authoritative
        # distribution readers use for `empirical_pmf`), but the shared
        # `projections.quantiles` column is NOT NULL and the baseline populates a
        # quantile grid for count families too. So emit the empirical grid here as
        # well — it costs nothing (the draws are in hand) and keeps the two engines'
        # stored shape uniform. Without it, every count-stat simulation projection
        # (receptions, TDs) violates the not-null constraint at persist.
        quantiles = to_quantile_grid(draws)
        params = _summary_params(draws, include_sd=False)
        projected_median = _pmf_median(pmf)
        low, high = _pmf_interval(pmf, 0.10, 0.90)
        distribution_kind = DISTRIBUTION_KIND_PMF
        family = FAMILY_COUNT

    relative_width = _relative_width(family, projected_value, low, high)
    confidence = _confidence(family, player.n_eff, relative_width)
    drivers = _drivers(
        stat_type=stat_type,
        player=player,
        team_volume_mean=team_volume_mean,
        league_volume_ref=league_volume_ref,
        player_stat_mean=projected_value,
    )
    return SimulatedProjection(
        player_id=player.player_id,
        game_id=game_id,
        stat_type=stat_type,
        model_version=SIMULATION_MODEL_VERSION,
        distribution_kind=distribution_kind,
        params=params,
        quantiles=quantiles,
        pmf=pmf,
        projected_value=projected_value,
        projected_median=projected_median,
        interval_low=low,
        interval_high=high,
        confidence=confidence,
        n_eff=player.n_eff,
        drivers=drivers,
        computed_at=computed_at,
        information_cutoff=information_cutoff,
    )


def _pmf_median(pmf: list[float]) -> float:
    """The 0.5 quantile of an explicit PMF: the first index whose CDF >= 0.5."""
    cumulative = 0.0
    for k, mass in enumerate(pmf):
        cumulative += mass
        if cumulative >= 0.5:
            return float(k)
    return float(len(pmf) - 1)


def _pmf_interval(pmf: list[float], low_q: float, high_q: float) -> tuple[float, float]:
    """The (low_q, high_q) quantiles of an explicit PMF, as integer support points."""

    def q(target: float) -> float:
        cumulative = 0.0
        for k, mass in enumerate(pmf):
            cumulative += mass
            if cumulative >= target:
                return float(k)
        return float(len(pmf) - 1)

    return q(low_q), q(high_q)
