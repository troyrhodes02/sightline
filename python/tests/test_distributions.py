"""Property tests for the distribution layer (SIG-15).

No database, no network, no fixtures — pure functions over numbers. These run
everywhere and are the reason every later PR can assume this layer is correct
rather than re-checking it.

The properties chosen are the ones whose violation would be invisible
downstream: a PMF that does not sum to one shifts every threshold probability
by a constant nobody would notice; a continuous fit that places mass below zero
makes a "probability of at least 24.5 yards" quietly wrong in the safe-looking
direction.
"""

from __future__ import annotations

import math

import pytest

from sightline_model.constants import SIGMA_FLOOR
from sightline_model.distributions import (
    DistributionError,
    NegativeBinomial,
    ZeroInflatedLogNormal,
    count_moments,
    fit_negative_binomial,
    lognormal_moments,
)
from sightline_model.stat_types import REGISTRY, spec

# A sweep wide enough to cover what real eligible history produces: a bad
# rookie week, a career day, a player who never scores.
ZIL_PARAMS = [
    (0.00, 3.9, 0.60),
    (0.05, 4.2, 0.90),
    (0.20, 3.0, 1.40),
    (0.45, 2.2, 0.35),
    (0.90, 1.0, 2.00),
]
NB_PARAMS = [
    (0.4, 8.0), (1.0, 2.5), (2.0, 1.2), (4.5, 0.9), (0.05, 0.4),
]


# --- Zero-inflated log-normal ----------------------------------------------


@pytest.mark.parametrize("p_zero,mu,sigma", ZIL_PARAMS)
def test_zil_threshold_probability_is_monotone_and_bounded(p_zero, mu, sigma) -> None:
    dist = ZeroInflatedLogNormal(p_zero=p_zero, mu=mu, sigma=sigma)
    previous = 1.1
    for threshold in [0.5, 4.5, 24.5, 49.5, 74.5, 99.5, 149.5, 299.5, 499.5]:
        p = dist.prob_at_least(threshold)
        assert 0.0 <= p <= 1.0
        assert p <= previous + 1e-12, "P(X >= t) rose as t rose"
        previous = p


@pytest.mark.parametrize("p_zero,mu,sigma", ZIL_PARAMS)
def test_zil_places_no_mass_below_zero(p_zero, mu, sigma) -> None:
    dist = ZeroInflatedLogNormal(p_zero=p_zero, mu=mu, sigma=sigma)
    assert dist.mass_below_zero() == 0.0
    assert dist.prob_at_least(0.0) == 1.0
    assert all(v >= 0.0 for v in dist.quantiles().values())


@pytest.mark.parametrize("p_zero,mu,sigma", ZIL_PARAMS)
def test_zil_quantiles_are_non_decreasing(p_zero, mu, sigma) -> None:
    dist = ZeroInflatedLogNormal(p_zero=p_zero, mu=mu, sigma=sigma)
    values = list(dist.quantiles().values())
    assert values == sorted(values)


@pytest.mark.parametrize("p_zero,mu,sigma", ZIL_PARAMS)
def test_zil_quantile_and_threshold_probability_agree(p_zero, mu, sigma) -> None:
    # The two must describe one object. If they can disagree, the quantile grid
    # stops being a view of the parameters and becomes a second opinion.
    dist = ZeroInflatedLogNormal(p_zero=p_zero, mu=mu, sigma=sigma)
    for q in (0.25, 0.5, 0.75, 0.9):
        x = dist.quantile(q)
        if x <= 0.0:
            continue
        assert dist.prob_at_least(x) == pytest.approx(1.0 - q, abs=1e-9)


def test_zil_mean_matches_a_numeric_integral() -> None:
    dist = ZeroInflatedLogNormal(p_zero=0.15, mu=4.0, sigma=0.8)
    # Crude midpoint integration of the survival function: E[X] = ∫ P(X > x) dx.
    step, total, x = 0.5, 0.0, 0.0
    while x < 4000:
        total += dist.prob_at_least(x + step / 2) * step
        x += step
    assert total == pytest.approx(dist.mean(), rel=1e-3)


def test_zil_rejects_degenerate_parameters() -> None:
    for kwargs in (
        {"p_zero": -0.1, "mu": 4.0, "sigma": 0.8},
        {"p_zero": 1.2, "mu": 4.0, "sigma": 0.8},
        {"p_zero": 0.1, "mu": 4.0, "sigma": 0.0},
        {"p_zero": 0.1, "mu": float("nan"), "sigma": 0.8},
    ):
        with pytest.raises(DistributionError):
            ZeroInflatedLogNormal(**kwargs)


def test_sigma_floor_prevents_an_absurd_interval() -> None:
    # Three near-identical games would otherwise produce an interval so narrow
    # that the confidence rule reads it as certainty.
    _, _, sigma = lognormal_moments([62.0, 62.4, 61.8])
    assert sigma == SIGMA_FLOOR

    dist = ZeroInflatedLogNormal(p_zero=0.0, mu=math.log(62.0), sigma=sigma)
    spread = dist.quantile(0.9) - dist.quantile(0.1)
    assert spread > 25.0, f"interval implausibly narrow: {spread}"


def test_lognormal_moments_ignore_zeros_in_the_location_estimate() -> None:
    # Zeros belong to the inflation term. Averaging log(0) is not available and
    # averaging 0 alongside 60 would drag the location down twice.
    p_zero, mu, _ = lognormal_moments([0.0, 0.0, 60.0, 60.0])
    assert p_zero == pytest.approx(0.5)
    assert mu == pytest.approx(math.log(60.0))


def test_all_zero_sample_is_representable() -> None:
    # A tight end with four eligible games and no receiving yards is a real
    # player, not an error.
    p_zero, mu, sigma = lognormal_moments([0.0, 0.0, 0.0, 0.0])
    assert p_zero == 1.0
    assert sigma >= SIGMA_FLOOR
    assert ZeroInflatedLogNormal(p_zero=p_zero, mu=mu, sigma=sigma).mean() == 0.0


def test_empty_sample_raises_rather_than_inventing_a_distribution() -> None:
    with pytest.raises(DistributionError):
        lognormal_moments([])
    with pytest.raises(DistributionError):
        count_moments([])


# --- Negative binomial -------------------------------------------------------


@pytest.mark.parametrize("mean,variance_mult", NB_PARAMS)
@pytest.mark.parametrize("cap", [4, 15])
def test_nb_pmf_and_tail_sum_to_one(mean, variance_mult, cap) -> None:
    dist = fit_negative_binomial(
        mean=mean, variance=mean * (1.0 + variance_mult), cap=cap
    )
    total = sum(dist.pmf()) + dist.tail_mass()
    assert total == pytest.approx(1.0, abs=1e-9)


@pytest.mark.parametrize("mean,variance_mult", NB_PARAMS)
def test_nb_threshold_probability_is_monotone_and_bounded(mean, variance_mult) -> None:
    dist = fit_negative_binomial(
        mean=mean, variance=mean * (1.0 + variance_mult), cap=15
    )
    previous = 1.1
    for threshold in (0.5, 1.5, 2.5, 3.5, 5.5, 8.5):
        p = dist.prob_at_least(threshold)
        assert 0.0 <= p <= 1.0
        assert p <= previous + 1e-12
        previous = p


def test_nb_mean_matches_its_own_pmf() -> None:
    dist = fit_negative_binomial(mean=4.2, variance=7.0, cap=40)
    from_pmf = sum(k * m for k, m in enumerate(dist.pmf()))
    assert from_pmf == pytest.approx(dist.mean(), rel=1e-3)


def test_zero_heavy_count_keeps_its_zero_mass() -> None:
    # One touchdown in twelve games. The zero must be a number you can read,
    # not an integral under a curve that was never about counts.
    values = [0.0] * 11 + [1.0]
    mean, variance = count_moments(values)
    dist = fit_negative_binomial(mean=mean, variance=variance, cap=spec("receiving_tds").pmf_cap)

    assert dist.zero_mass() > 0.6, dist.zero_mass()
    assert dist.pmf()[0] == dist.zero_mass()
    # And the "anytime touchdown" threshold reads straight off it.
    assert dist.prob_at_least(0.5) == pytest.approx(1.0 - dist.zero_mass(), abs=1e-12)


def test_under_dispersed_sample_still_fits() -> None:
    # Every game exactly four receptions: variance 0, which has no valid
    # negative binomial fit until dispersion is forced above the mean.
    mean, variance = count_moments([4.0, 4.0, 4.0, 4.0])
    dist = fit_negative_binomial(mean=mean, variance=variance, cap=15)
    assert math.isfinite(dist.r) and dist.r > 0
    assert dist.mean() == pytest.approx(4.0, rel=1e-6)


def test_nb_rejects_degenerate_parameters() -> None:
    with pytest.raises(DistributionError):
        fit_negative_binomial(mean=0.0, variance=1.0, cap=4)
    with pytest.raises(DistributionError):
        NegativeBinomial(r=-1.0, p=0.5, cap=4)
    with pytest.raises(DistributionError):
        NegativeBinomial(r=1.0, p=0.0, cap=4)


def test_tail_mass_is_never_negative_at_a_low_cap() -> None:
    # A cap of 4 on a distribution centred at 4.5 leaves real mass above it;
    # truncating instead of carrying a tail would inflate every threshold
    # probability below the cap.
    dist = fit_negative_binomial(mean=4.5, variance=9.0, cap=4)
    assert dist.tail_mass() > 0.0
    assert sum(dist.pmf()) + dist.tail_mass() == pytest.approx(1.0, abs=1e-9)


# --- Registry ----------------------------------------------------------------


def test_every_registered_stat_type_has_a_usable_grid() -> None:
    for name, s in REGISTRY.items():
        assert s.thresholds, f"{name} has no thresholds"
        assert list(s.thresholds) == sorted(s.thresholds)
        assert all(abs(t % 1 - 0.5) < 1e-9 for t in s.thresholds), (
            f"{name} has a threshold that can tie with an integer outcome"
        )
        if s.is_count:
            assert s.pmf_cap and s.pmf_cap >= max(s.thresholds)
