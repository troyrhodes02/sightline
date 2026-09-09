"""Layer 3 (efficiency) unit tests — no database required.

Covers shrinkage of a player's trailing efficiency toward his position prior
(a sparse player regresses, a well-evidenced one does not), the vectorised
samplers (shape, reproducibility, no per-draw loop), and the large zero mass a
low-rate TD binomial leaves. The as-of feature-assembly guarantee is exercised
adversarially with a database in ``test_asof_leakage.py``; here the fit is a set
of position priors, so shrinkage is testable structurally.
"""

from __future__ import annotations

import inspect

import numpy as np
import pytest

from sightline_model.priors import Prior
from sightline_model.simulation import efficiency as ef
from sightline_model.simulation.efficiency import (
    EFFICIENCY_KEYS,
    EfficiencyHistory,
    EfficiencyModel,
    PlayerEfficiency,
    sample_passing,
    sample_receiving,
    sample_rushing,
)


def _prior(position: str, key: str, mean: float) -> Prior:
    return Prior(
        season=2024,
        stat_type=key,
        position=position,
        fitted_from_seasons=(2022, 2023),
        sample_games=500,
        sample_players=40,
        mean=mean,
        variance=mean * 1.5,
    )


def _wr_priors() -> dict[tuple[str, str], Prior]:
    return {
        ("WR", "yards_per_target"): _prior("WR", "yards_per_target", 8.0),
        ("WR", "catch_rate"): _prior("WR", "catch_rate", 0.62),
        ("WR", "rec_td_rate"): _prior("WR", "rec_td_rate", 0.05),
    }


# --- Shrinkage --------------------------------------------------------------


def test_sparse_player_regresses_to_position_prior() -> None:
    # A one-game player with a wild trailing rate should end up near the prior,
    # not near his own lucky sample (K0 = 4 games of prior weight).
    model = EfficiencyModel(_wr_priors())
    hot = EfficiencyHistory(
        player_id="wr_hot",
        position="WR",
        n_eff=1,
        yards_per_target=20.0,  # absurd one-game rate
        catch_rate=1.0,
        rec_td_rate=0.5,
    )
    eff = model.predict(hot)
    # Shrunk toward 8.0 with n_eff=1, k0=4: (1*20 + 4*8)/5 = 10.4, far from 20.
    assert eff.yards_per_target == pytest.approx((1 * 20.0 + 4 * 8.0) / 5.0)
    assert eff.yards_per_target < 12.0


def test_established_player_keeps_his_own_rate() -> None:
    model = EfficiencyModel(_wr_priors())
    established = EfficiencyHistory(
        player_id="wr_star",
        position="WR",
        n_eff=40,
        yards_per_target=11.0,
        catch_rate=0.70,
        rec_td_rate=0.08,
    )
    eff = model.predict(established)
    # (40*11 + 4*8)/44 = 10.7 — mostly his own rate.
    assert eff.yards_per_target == pytest.approx((40 * 11.0 + 4 * 8.0) / 44.0)
    assert eff.yards_per_target > 10.0


def test_missing_channel_falls_back_to_prior_not_fabricated() -> None:
    model = EfficiencyModel(_wr_priors())
    no_own = EfficiencyHistory(player_id="wr_new", position="WR", n_eff=3)
    eff = model.predict(no_own)
    assert eff.yards_per_target == pytest.approx(8.0)  # the prior mean
    assert eff.catch_rate == pytest.approx(0.62)


def test_model_persists_and_reloads(tmp_path) -> None:
    model = EfficiencyModel(_wr_priors())
    path = tmp_path / "eff.joblib"
    model.save(path)
    reloaded = EfficiencyModel.load(path)
    h = EfficiencyHistory(player_id="wr", position="WR", n_eff=5, yards_per_target=9.0)
    assert model.predict(h).yards_per_target == reloaded.predict(h).yards_per_target


def test_efficiency_keys_are_the_fixed_set() -> None:
    assert EFFICIENCY_KEYS == (
        "yards_per_target",
        "catch_rate",
        "yards_per_carry",
        "yards_per_pass_attempt",
        "pass_td_rate",
        "rush_td_rate",
        "rec_td_rate",
    )


# --- Samplers: vectorised, reproducible -------------------------------------


def _rec_eff() -> PlayerEfficiency:
    return PlayerEfficiency(
        player_id="wr1",
        position="WR",
        n_eff=10,
        yards_per_target=8.0,
        catch_rate=0.65,
        rec_td_rate=0.06,
    )


def test_receiving_sampler_shape_and_dtype() -> None:
    rng = np.random.default_rng(1)
    targets = rng.integers(0, 12, size=5000)
    out = sample_receiving(rng, targets=targets, efficiency=_rec_eff(), draw_count=5000)
    assert set(out) == {"receiving_yards", "receptions", "receiving_tds"}
    for arr in out.values():
        assert arr.shape == (5000,)
    assert np.issubdtype(out["receptions"].dtype, np.integer)
    assert np.issubdtype(out["receiving_tds"].dtype, np.integer)
    # Receptions never exceed targets (catch Bernoulli thins them).
    assert np.all(out["receptions"] <= targets)


def test_receiving_expected_yards_track_targets_times_ypt() -> None:
    # Over many draws the mean receiving yards should be close to
    # targets * yards_per_target (the efficiency the sim used), confirming the
    # per-reception conditioning keeps the total unbiased.
    rng = np.random.default_rng(7)
    targets = np.full(20000, 8, dtype=np.int64)
    out = sample_receiving(rng, targets=targets, efficiency=_rec_eff(), draw_count=20000)
    assert out["receiving_yards"].mean() == pytest.approx(8 * 8.0, rel=0.05)


def test_low_catch_rate_does_not_explode_receiving_yards() -> None:
    # Review fix: a non-receiver whose catch rate shrinks to ~0 (clamped to the
    # RATE_FLOOR) but with a positive yards-per-target must NOT produce an
    # exploding per-reception yardage (ypt / RATE_FLOOR ~ 80,000). The receptions
    # stay ~0 (so the expected total is ~0), and the rare reception that does draw
    # must be physically bounded rather than corrupting the q99 grid / the mean.
    eff = PlayerEfficiency(
        player_id="ol1",
        position="OL",
        n_eff=10,
        yards_per_target=8.0,
        catch_rate=1e-6,  # clamped to RATE_FLOOR; a non-receiver
        rec_td_rate=0.0,
    )
    rng = np.random.default_rng(11)
    targets = np.full(20000, 6, dtype=np.int64)
    out = sample_receiving(rng, targets=targets, efficiency=eff, draw_count=20000)
    yards = out["receiving_yards"]
    # Expected total is ~0 (a non-receiver catches almost nothing).
    assert yards.mean() < 5.0
    # And no draw is an absurd outlier: the divisor floor bounds a single
    # reception's mean at ypt / YARDAGE_CATCH_FLOOR = 8 / 0.05 = 160, so even a
    # long-tail LogNormal reception stays within a few hundred yards, not 80,000.
    assert yards.max() < 2000.0


def test_samplers_contain_no_python_loop_over_draws() -> None:
    source = (
        inspect.getsource(sample_receiving)
        + inspect.getsource(sample_rushing)
        + inspect.getsource(sample_passing)
        + inspect.getsource(ef._yardage_from_counts)
    )
    assert "range(draw_count)" not in source
    assert "for _ in range" not in source
    # No per-draw iteration: the only comprehension/loop is the strict-monotone
    # nudge, which is over the (fixed, small) grid, not the draws.


def test_samplers_are_reproducible_given_a_seeded_rng() -> None:
    targets = np.random.default_rng(3).integers(0, 12, size=3000)
    a = sample_receiving(np.random.default_rng(42), targets=targets, efficiency=_rec_eff(), draw_count=3000)
    b = sample_receiving(np.random.default_rng(42), targets=targets, efficiency=_rec_eff(), draw_count=3000)
    for stat in a:
        assert np.array_equal(a[stat], b[stat])


def test_low_rate_td_binomial_leaves_large_zero_mass() -> None:
    rng = np.random.default_rng(11)
    # 6 carries at a 3% per-carry TD rate: P(0 TDs) = 0.97^6 ~ 0.83.
    carries = np.full(50000, 6, dtype=np.int64)
    eff = PlayerEfficiency(
        player_id="rb", position="RB", n_eff=10, yards_per_carry=4.2, rush_td_rate=0.03
    )
    out = sample_rushing(rng, carries=carries, efficiency=eff, draw_count=50000)
    zero_frac = float(np.mean(out["rushing_tds"] == 0))
    assert zero_frac > 0.75, f"expected large zero mass, got {zero_frac}"


def test_zero_opportunity_yields_zero_yards() -> None:
    rng = np.random.default_rng(5)
    carries = np.zeros(1000, dtype=np.int64)
    eff = PlayerEfficiency(
        player_id="rb", position="RB", n_eff=10, yards_per_carry=4.2, rush_td_rate=0.03
    )
    out = sample_rushing(rng, carries=carries, efficiency=eff, draw_count=1000)
    assert np.all(out["rushing_yards"] == 0.0)
    assert np.all(out["rushing_tds"] == 0)
