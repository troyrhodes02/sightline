"""The two distribution families, closed-form.

**Nothing here draws a random number.** The baseline engine is analytic, so
determinism is a property of the computation rather than of a seed, and
``BacktestRun.rng_draws`` is written as 0 and asserted. The Simulation Engine
(Pitch 7) will need sampling; this does not.

Two families, chosen for what they refuse to do:

* **Zero-inflated log-normal** for yardage. Support is ``[0, inf)``, so no
  parameterisation can place mass below zero — which a normal approximation
  cheerfully does for a receiver projected at 30 yards, and which no amount of
  clamping afterward makes honest. The zero-inflation term carries the games a
  player was active and produced nothing, which is a real and common outcome.
* **Negative binomial** for counts. The PMF is explicit, so the probability of
  exactly zero touchdowns is a number you can read rather than an integral
  under a curve that was never meant to describe counts.

Every threshold probability is evaluated from the stored **parameters**. The
quantile grid emitted alongside them is for display and for the
mass-below-zero detector; reading a probability off it would be interpolation
where an exact answer exists.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist

from .constants import COUNT_MIN_DISPERSION, SIGMA_FLOOR

# The quantile grid emitted with every projection. p10/p90 are the stored
# interval; the rest give the shape enough resolution to be inspected.
QUANTILE_GRID = (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)

_STD_NORMAL = NormalDist(0.0, 1.0)

KIND_ZIL = "zero_inflated_lognormal"
KIND_NB = "negative_binomial"


class DistributionError(ValueError):
    """A distribution could not be fitted or is not usable.

    Raised rather than returning a degenerate object: a projection built on a
    NaN parameter would propagate silently into an aggregate, and the whole
    point of this pitch is that aggregates cannot be quietly wrong.
    """


# ---------------------------------------------------------------------------
# Zero-inflated log-normal
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ZeroInflatedLogNormal:
    """``P(X = 0) = p_zero``; otherwise ``log X ~ Normal(mu, sigma)``."""

    p_zero: float
    mu: float
    sigma: float

    kind = KIND_ZIL

    def __post_init__(self) -> None:
        for name, value in (("p_zero", self.p_zero), ("mu", self.mu), ("sigma", self.sigma)):
            if not math.isfinite(value):
                raise DistributionError(f"{name} is not finite: {value!r}")
        if not 0.0 <= self.p_zero <= 1.0:
            raise DistributionError(f"p_zero out of range: {self.p_zero!r}")
        if self.sigma <= 0.0:
            raise DistributionError(f"sigma must be positive: {self.sigma!r}")

    @property
    def params(self) -> dict[str, float]:
        return {"p_zero": self.p_zero, "mu": self.mu, "sigma": self.sigma}

    def mean(self) -> float:
        return (1.0 - self.p_zero) * math.exp(self.mu + self.sigma**2 / 2.0)

    def prob_at_least(self, threshold: float) -> float:
        """``P(X >= t)``. Thresholds are ``.5`` values, so ties never arise."""
        if threshold <= 0.0:
            return 1.0
        z = (math.log(threshold) - self.mu) / self.sigma
        return (1.0 - self.p_zero) * (1.0 - _STD_NORMAL.cdf(z))

    def quantile(self, q: float) -> float:
        if not 0.0 < q < 1.0:
            raise DistributionError(f"quantile out of range: {q!r}")
        if q <= self.p_zero:
            return 0.0
        adjusted = (q - self.p_zero) / (1.0 - self.p_zero)
        return math.exp(self.mu + self.sigma * _STD_NORMAL.inv_cdf(adjusted))

    def mass_below_zero(self) -> float:
        """Structurally zero — emitted anyway as the detector.

        If this is ever non-zero, the distribution family is wrong for the
        stat, and that is worth one cheap column in every artefact rather than
        a bug report in February.
        """
        return 0.0

    def quantiles(self) -> dict[str, float]:
        return {f"q{int(q * 100):02d}": self.quantile(q) for q in QUANTILE_GRID}


def fit_zero_inflated_lognormal(
    values: list[float], *, p_zero: float, mu: float, sigma: float
) -> ZeroInflatedLogNormal:
    """Assemble from already-shrunk moments (see ``priors.shrink``)."""
    del values  # kept for symmetry with the count fitter's signature
    return ZeroInflatedLogNormal(
        p_zero=min(max(p_zero, 0.0), 1.0), mu=mu, sigma=max(sigma, SIGMA_FLOOR)
    )


def lognormal_moments(values: list[float]) -> tuple[float, float, float]:
    """``(p_zero, mu, sigma)`` from a sample, before any shrinkage.

    ``mu`` and ``sigma`` are estimated on the log of the strictly positive
    values only — zeros belong to the inflation term, and ``log 0`` is not a
    number this or any other model can use.
    """
    if not values:
        raise DistributionError("cannot estimate moments from an empty sample")
    positives = [v for v in values if v > 0.0]
    p_zero = 1.0 - len(positives) / len(values)
    if not positives:
        # Every eligible game produced nothing. The location is undefined; the
        # caller shrinks it to the prior, and p_zero already says what happened.
        return 1.0, 0.0, SIGMA_FLOOR
    logs = [math.log(v) for v in positives]
    mu = sum(logs) / len(logs)
    if len(logs) == 1:
        return p_zero, mu, SIGMA_FLOOR
    variance = sum((x - mu) ** 2 for x in logs) / (len(logs) - 1)
    return p_zero, mu, max(math.sqrt(variance), SIGMA_FLOOR)


# ---------------------------------------------------------------------------
# Negative binomial
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NegativeBinomial:
    """Over-dispersed counts. ``r`` failures, success probability ``p``."""

    r: float
    p: float
    cap: int

    kind = KIND_NB

    def __post_init__(self) -> None:
        if not math.isfinite(self.r) or self.r <= 0.0:
            raise DistributionError(f"r must be finite and positive: {self.r!r}")
        if not 0.0 < self.p <= 1.0:
            raise DistributionError(f"p out of range: {self.p!r}")
        if self.cap < 1:
            raise DistributionError(f"cap must be at least 1: {self.cap!r}")

    @property
    def params(self) -> dict[str, float]:
        return {"r": self.r, "p": self.p}

    def pmf(self) -> list[float]:
        """``P(X = k)`` for ``k = 0 .. cap``.

        Built by the standard recurrence rather than by evaluating a gamma
        function per term: fewer operations, and no library dependency for a
        distribution this simple.
        """
        out = [self.p**self.r]
        for k in range(1, self.cap + 1):
            out.append(out[-1] * (self.r + k - 1) / k * (1.0 - self.p))
        return out

    def tail_mass(self) -> float:
        """Mass above ``cap``. Never truncated away — the PMF must sum to 1."""
        return max(0.0, 1.0 - sum(self.pmf()))

    def mean(self) -> float:
        return self.r * (1.0 - self.p) / self.p

    def prob_at_least(self, threshold: float) -> float:
        k = math.ceil(threshold)
        if k <= 0:
            return 1.0
        pmf = self.pmf()
        below = sum(pmf[: min(k, len(pmf))])
        return max(0.0, min(1.0, 1.0 - below))

    def quantile(self, q: float) -> float:
        if not 0.0 < q < 1.0:
            raise DistributionError(f"quantile out of range: {q!r}")
        cumulative = 0.0
        for k, mass in enumerate(self.pmf()):
            cumulative += mass
            if cumulative >= q:
                return float(k)
        return float(self.cap)

    def mass_below_zero(self) -> float:
        return 0.0

    def quantiles(self) -> dict[str, float]:
        return {f"q{int(q * 100):02d}": self.quantile(q) for q in QUANTILE_GRID}

    def zero_mass(self) -> float:
        """``P(X = 0)``, first-class because zero-heavy stats are the point."""
        return self.pmf()[0]


def fit_negative_binomial(*, mean: float, variance: float, cap: int) -> NegativeBinomial:
    """Method of moments, with dispersion forced above the mean.

    A sample whose variance is at or below its mean has no valid negative
    binomial fit (``r`` diverges or goes negative). Nudging the variance just
    above the mean keeps one family for the whole count stat family; the
    alternative is a Poisson special case, and two families for one family of
    stats is how a "which distribution is this?" branch appears in feature code.
    """
    if mean <= 0.0:
        raise DistributionError(f"mean must be positive: {mean!r}")
    variance = max(variance, mean * COUNT_MIN_DISPERSION)
    p = mean / variance
    r = mean * mean / (variance - mean)
    return NegativeBinomial(r=r, p=p, cap=cap)


def count_moments(values: list[float]) -> tuple[float, float]:
    """``(mean, variance)`` from a count sample, before shrinkage."""
    if not values:
        raise DistributionError("cannot estimate moments from an empty sample")
    mean = sum(values) / len(values)
    if len(values) == 1:
        return mean, mean * COUNT_MIN_DISPERSION
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return mean, variance
