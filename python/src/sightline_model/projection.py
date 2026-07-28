"""The Projection Engine, first implementation.

Turns eligible history plus a population prior into a distribution — never a
point estimate. Kalshi asks binary threshold questions, so the object that has
to survive is the one any threshold probability can be derived from, and it has
to survive without a refit: adding a threshold must cost an arithmetic call.

Every projection carries what a reader needs to judge it: the parameters, the
interval, the confidence *and both of the inputs that produced it*, the drivers,
the model version, when it was computed, and the cutoff it was computed against.
``computed_at`` and ``information_cutoff`` are two different timestamps and are
never conflated — a recompute today against a Friday cutoff is a real state.

The engine declines rather than guessing. Zero eligible games produces an
explicit ``Unprojectable`` with a reason code, not a confident-looking
population prior wearing a player's name.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .constants import (
    CONFIDENCE_BANDS,
    K0,
    MIN_ELIGIBLE_GAMES,
    MIN_HISTORY_FOR_MEDIUM,
    MODEL_VERSION,
    N_FOR_HIGH,
)
from .distributions import (
    NegativeBinomial,
    ZeroInflatedLogNormal,
    count_moments,
    fit_negative_binomial,
    fit_zero_inflated_lognormal,
    lognormal_moments,
)
from .features import EligibleHistory
from .priors import Prior, prior_weight, shrink
from .stat_types import StatTypeSpec

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"

REASON_INSUFFICIENT_HISTORY = "insufficient_history"

# Cohort flags. Precomputed here so the harness writes them into the artefact
# and the CLI can filter on them without re-deriving a definition that would
# then exist in two places.
COHORT_SPARSE = "sparse"
COHORT_LOW_CONFIDENCE = "low_confidence"
COHORT_ROLE_CHANGE = "role_change"
COHORT_RETURNING = "returning"
COHORT_IMPOSSIBLE = "impossible_output"


@dataclass(frozen=True)
class Unprojectable:
    """An explicit decline, with a reason. Retained, never silently dropped."""

    player_id: str
    game_id: str
    stat_type: str
    reason: str
    information_cutoff: datetime
    n_eff: int = 0


@dataclass(frozen=True)
class ProjectionResult:
    """One player, one stat type, one game, one model version, one cutoff."""

    player_id: str
    game_id: str
    stat_type: str
    model_version: str

    distribution_kind: str
    params: dict[str, float]
    quantiles: dict[str, float]
    pmf: list[float] | None
    tail_mass: float | None
    zero_mass: float | None

    projected_value: float
    interval_low: float
    interval_high: float
    mass_below_zero: float

    confidence: str
    n_eff: int
    relative_width: float

    drivers: list[str]
    cohorts: list[str] = field(default_factory=list)

    computed_at: datetime | None = None
    information_cutoff: datetime | None = None

    def prob_at_least(self, threshold: float) -> float:
        """Any threshold, from the stored parameters, with no refit."""
        return _rehydrate(self).prob_at_least(threshold)


def _rehydrate(result: ProjectionResult):
    """Rebuild the distribution from stored parameters.

    This is what makes "adding a threshold does not require the model to be
    rerun" true rather than aspirational: the artefact carries enough to
    reconstruct the object exactly, so a threshold added in Pitch 4 is answered
    from a Parquet row.
    """
    if result.distribution_kind == ZeroInflatedLogNormal.kind:
        return ZeroInflatedLogNormal(**result.params)
    return NegativeBinomial(**result.params, cap=len(result.pmf or []) - 1)


def _relative_width(
    spec: StatTypeSpec, projected: float, low: float, high: float
) -> float:
    """Interval width, normalised per family. See ``CONFIDENCE_BANDS``."""
    band = CONFIDENCE_BANDS[spec.family]
    denominator = max(projected, band["floor"]) + band["offset"]
    return (high - low) / denominator


def _confidence(spec: StatTypeSpec, n_eff: int, relative_width: float) -> str:
    """Evaluated in order; first match wins. Ordinal, not a probability."""
    band = CONFIDENCE_BANDS[spec.family]
    if n_eff < MIN_HISTORY_FOR_MEDIUM:
        return CONFIDENCE_LOW
    if relative_width > band["w_low"]:
        return CONFIDENCE_LOW
    if n_eff >= N_FOR_HIGH and relative_width <= band["w_high"]:
        return CONFIDENCE_HIGH
    return CONFIDENCE_MEDIUM


def _drivers(
    spec: StatTypeSpec,
    history: EligibleHistory,
    prior: Prior,
    sample: float,
    projected: float,
) -> list[str]:
    """Deterministic sentences, ordered by contribution to the posterior.

    No driver may reference a value the projection did not use. A narrated
    driver — one that describes a plausible football reason the model never
    consulted — is worse than no driver, because it makes an unexplained
    projection look explained.
    """
    weight = prior_weight(history.n_eff)
    out = [
        f"{history.n_eff} eligible prior games; exponentially-weighted form "
        f"{sample:.1f} {spec.name.replace('_', ' ')}.",
        f"Shrunk {weight * 100:.0f}% toward the {prior.position} prior for "
        f"{prior.season}, fitted on {prior.fitted_from_seasons[0]}–"
        f"{prior.fitted_from_seasons[-1]} "
        f"({prior.sample_games:,} player-games).",
    ]
    zero_rate = history.zero_rate()
    if zero_rate is not None and zero_rate > 0.0:
        out.append(
            f"Produced nothing in {zero_rate * 100:.0f}% of eligible games in the "
            f"form window."
        )
    if history.crosses_season_boundary():
        out.append("Form window crosses a season boundary.")
    out.append(f"Projected value {projected:.1f}, prior weight {weight:.2f}.")
    return out


def project_one(
    history: EligibleHistory,
    *,
    prior: Prior,
    spec: StatTypeSpec,
    game_id: str,
    kickoff: datetime,
    information_cutoff: datetime,
    computed_at: datetime,
) -> ProjectionResult | Unprojectable:
    """Project one player-stat-game, or decline with a reason."""
    if history.n_eff < MIN_ELIGIBLE_GAMES:
        # Zero eligible games is not a wide projection, it is no projection.
        return Unprojectable(
            player_id=history.player_id, game_id=game_id, stat_type=spec.name,
            reason=REASON_INSUFFICIENT_HISTORY, information_cutoff=information_cutoff,
        )

    if spec.is_continuous:
        distribution, sample = _fit_continuous(history, prior)
    else:
        distribution, sample = _fit_count(history, prior, spec)

    quantiles = distribution.quantiles()
    projected = distribution.mean()
    low, high = quantiles["q10"], quantiles["q90"]
    relative_width = _relative_width(spec, projected, low, high)
    confidence = _confidence(spec, history.n_eff, relative_width)

    cohorts: list[str] = []
    if history.n_eff < MIN_HISTORY_FOR_MEDIUM:
        cohorts.append(COHORT_SPARSE)
    if confidence == CONFIDENCE_LOW:
        cohorts.append(COHORT_LOW_CONFIDENCE)
    if history.is_returning(kickoff):
        cohorts.append(COHORT_RETURNING)
    mass_below_zero = distribution.mass_below_zero()
    if mass_below_zero > 0.0:
        # Structurally unreachable with these families. Flagged rather than
        # asserted, so a future family change surfaces as a cohort count in the
        # artefact instead of a crash halfway through a five-season run.
        cohorts.append(COHORT_IMPOSSIBLE)

    is_count = spec.is_count
    return ProjectionResult(
        player_id=history.player_id,
        game_id=game_id,
        stat_type=spec.name,
        model_version=MODEL_VERSION,
        distribution_kind=distribution.kind,
        params=distribution.params,
        quantiles=quantiles,
        pmf=distribution.pmf() if is_count else None,
        tail_mass=distribution.tail_mass() if is_count else None,
        zero_mass=distribution.zero_mass() if is_count else None,
        projected_value=projected,
        interval_low=low,
        interval_high=high,
        mass_below_zero=mass_below_zero,
        confidence=confidence,
        n_eff=history.n_eff,
        relative_width=relative_width,
        drivers=_drivers(spec, history, prior, sample, projected),
        cohorts=cohorts,
        computed_at=computed_at,
        information_cutoff=information_cutoff,
    )


def _fit_continuous(
    history: EligibleHistory, prior: Prior
) -> tuple[ZeroInflatedLogNormal, float]:
    """Location from the exponentially-weighted window, dispersion from all of it.

    Recent form should move where the distribution sits; it should not be
    allowed to claim the spread is narrower than the player's record shows,
    which is what weighting the variance as well would do after two quiet weeks.
    """
    import math

    window, weights = history.window, history.weights()
    _, _, sigma = lognormal_moments(window)

    p_zero = sum(w for w, v in zip(weights, window) if v == 0.0)
    positives = [(w, v) for w, v in zip(weights, window) if v > 0.0]
    if positives:
        total = sum(w for w, _ in positives)
        mu = sum((w / total) * math.log(v) for w, v in positives)
    else:
        # Every eligible game produced nothing. Location is undefined and
        # p_zero already says so; shrinkage supplies the rest.
        mu = 0.0

    n_eff = history.n_eff
    distribution = fit_zero_inflated_lognormal(
        window,
        p_zero=shrink(p_zero, n_eff, prior.p_zero or 0.0, k0=K0),
        mu=shrink(mu, n_eff, prior.mu or 0.0, k0=K0),
        sigma=shrink(sigma, n_eff, prior.sigma or 0.0, k0=K0),
    )
    ew_mean = sum(w * v for w, v in zip(weights, window))
    return distribution, ew_mean


def _fit_count(
    history: EligibleHistory, prior: Prior, spec: StatTypeSpec
) -> tuple[NegativeBinomial, float]:
    window, weights = history.window, history.weights()
    _, variance = count_moments(window)
    ew_mean = sum(w * v for w, v in zip(weights, window))

    n_eff = history.n_eff
    shrunk_mean = shrink(ew_mean, n_eff, prior.mean or 0.0, k0=K0)
    shrunk_variance = shrink(variance, n_eff, prior.variance or 0.0, k0=K0)
    # A shrunk mean of exactly zero has no negative binomial fit. It happens
    # when a player and their whole position prior have never recorded the
    # stat; a floor keeps the distribution defined with a zero mass of ~1,
    # which is the honest description of that player.
    distribution = fit_negative_binomial(
        mean=max(shrunk_mean, 1e-4),
        variance=shrunk_variance,
        cap=spec.pmf_cap or 15,
    )
    return distribution, ew_mean
