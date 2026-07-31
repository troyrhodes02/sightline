"""The Projection Engine (SIG-16).

Pure tests over synthetic history — the corpus-backed half lives in
``test_features.py``. What is being pinned here is the behaviour a reader of a
projection depends on: that it is a distribution, that the same inputs always
give the same output, that the engine declines rather than guessing, and that
confidence reflects evidence rather than units.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from sightline_model.constants import K0, MODEL_VERSION
from sightline_model.features import EligibleHistory
from sightline_model.priors import Prior
from sightline_model.projection import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    REASON_INSUFFICIENT_HISTORY,
    COHORT_RETURNING,
    COHORT_SPARSE,
    ProjectionResult,
    Unprojectable,
    project_one,
)
from sightline_model.stat_types import spec

KICKOFF = datetime(2023, 10, 15, 17, 0)
CUTOFF = datetime(2023, 10, 15, 15, 30)
COMPUTED = datetime(2026, 7, 28, 12, 14)


def history(values: list[float], *, gap_weeks: int = 1, player: str = "p1") -> EligibleHistory:
    kickoffs = [
        KICKOFF.replace(day=15) - __import__("datetime").timedelta(weeks=gap_weeks * (len(values) - i))
        for i in range(len(values))
    ]
    return EligibleHistory(
        player_id=player,
        values=values,
        game_ids=[f"g{i}" for i in range(len(values))],
        kickoffs=kickoffs,
        seasons=[2023] * len(values),
    )


CONT_PRIOR = Prior(
    season=2023, stat_type="receiving_yards", position="WR",
    fitted_from_seasons=(2019, 2020, 2021, 2022), sample_games=18_000,
    sample_players=1_200, p_zero=0.12, mu=3.55, sigma=0.95,
)
COUNT_PRIOR = Prior(
    season=2023, stat_type="receiving_tds", position="TE",
    fitted_from_seasons=(2019, 2020, 2021, 2022), sample_games=18_000,
    sample_players=1_200, mean=0.35, variance=0.55,
)
RECEPTION_PRIOR = Prior(
    season=2023, stat_type="receptions", position="WR",
    fitted_from_seasons=(2019, 2020, 2021, 2022), sample_games=18_000,
    sample_players=1_200, mean=3.5, variance=6.0,
)


def project(values, *, s="receiving_yards", prior=None, gap_weeks=1):
    return project_one(
        history(values, gap_weeks=gap_weeks),
        prior=prior or CONT_PRIOR,
        spec=spec(s),
        game_id="game-1",
        kickoff=KICKOFF,
        information_cutoff=CUTOFF,
        computed_at=COMPUTED,
    )


# --- Output shape ------------------------------------------------------------


def test_projection_is_a_distribution_not_a_point_estimate() -> None:
    result = project([48.0, 62.0, 71.0, 55.0, 80.0, 66.0])
    assert isinstance(result, ProjectionResult)
    assert result.distribution_kind == "zero_inflated_lognormal"
    assert set(result.params) == {"p_zero", "mu", "sigma"}
    assert result.interval_low < result.projected_value < result.interval_high


def test_carries_both_point_estimates_and_median_is_the_stored_q50() -> None:
    # SIG-28: both the mean (headline) and the median (displayed) are carried.
    result = project([48.0, 62.0, 71.0, 55.0, 80.0, 66.0])
    assert result.projected_median == result.quantiles["q50"]
    # A right-skewed zero-inflated log-normal sits with its mean above its
    # median — the reason the mean over-projects and the median is displayed.
    assert result.projected_median <= result.projected_value


def test_every_projection_carries_its_provenance() -> None:
    result = project([48.0, 62.0, 71.0])
    assert result.model_version == MODEL_VERSION
    assert result.computed_at == COMPUTED
    assert result.information_cutoff == CUTOFF
    # Two different timestamps, never conflated: a recompute today against a
    # Friday cutoff is a real and important state.
    assert result.computed_at != result.information_cutoff


def test_confidence_carries_both_of_its_inputs() -> None:
    result = project([48.0, 62.0, 71.0, 55.0, 80.0, 66.0])
    assert result.confidence in {"high", "medium", "low"}
    assert result.n_eff == 6
    assert result.relative_width > 0
    # Retained so a confidence value is explicable without re-running the model.


def test_drivers_are_ordered_sentences_referencing_used_values() -> None:
    result = project([48.0, 62.0, 71.0, 55.0])
    assert 3 <= len(result.drivers) <= 5
    assert all(d.endswith(".") for d in result.drivers)
    assert "4 eligible prior games" in result.drivers[0]
    assert "WR prior" in result.drivers[1]


def test_threshold_probabilities_derive_from_stored_parameters() -> None:
    # The guarantee that makes "adding a threshold does not require a rerun"
    # true: rebuild from params alone and evaluate anything.
    result = project([48.0, 62.0, 71.0, 55.0, 80.0, 66.0])
    rebuilt = ProjectionResult(**{**result.__dict__})
    for t in (24.5, 74.5, 124.5):
        assert rebuilt.prob_at_least(t) == result.prob_at_least(t)
    # A threshold absent from grid-v1 answers just as well.
    assert 0.0 <= result.prob_at_least(87.5) <= 1.0


def test_threshold_probabilities_are_monotone_across_the_grid() -> None:
    result = project([48.0, 62.0, 71.0, 55.0, 80.0, 66.0])
    values = [result.prob_at_least(t) for t in spec("receiving_yards").thresholds]
    assert values == sorted(values, reverse=True)


# --- Determinism -------------------------------------------------------------


def test_reprojecting_the_same_inputs_is_identical() -> None:
    a = project([48.0, 62.0, 71.0, 55.0])
    b = project([48.0, 62.0, 71.0, 55.0])
    assert a == b


def test_order_of_the_window_matters_and_recency_is_weighted() -> None:
    # Exponential weighting is the whole point of the form window; a projection
    # invariant to order would mean the weights do nothing.
    rising = project([20.0, 30.0, 45.0, 90.0])
    falling = project([90.0, 45.0, 30.0, 20.0])
    assert rising.projected_value > falling.projected_value


# --- Declining rather than guessing ------------------------------------------


def test_zero_eligible_games_declines_with_a_reason() -> None:
    result = project([])
    assert isinstance(result, Unprojectable)
    assert result.reason == REASON_INSUFFICIENT_HISTORY
    assert result.n_eff == 0
    assert result.information_cutoff == CUTOFF


def test_one_eligible_game_is_low_confidence_and_prior_dominated() -> None:
    result = project([140.0])
    assert result.confidence == CONFIDENCE_LOW
    assert COHORT_SPARSE in result.cohorts
    # Mostly prior: the projection must sit far below a single 140-yard game.
    assert result.projected_value < 90.0
    # And its interval must be wider than a well-evidenced player's.
    settled = project([60.0, 64.0, 58.0, 62.0, 61.0, 63.0, 59.0, 60.0])
    assert (result.interval_high - result.interval_low) > (
        settled.interval_high - settled.interval_low
    )


def test_a_settled_player_can_reach_high_confidence() -> None:
    result = project([60.0, 64.0, 58.0, 62.0, 61.0, 63.0, 59.0, 60.0])
    assert result.confidence == CONFIDENCE_HIGH
    assert result.n_eff == 8


def test_all_three_confidence_levels_are_reachable_for_both_families() -> None:
    # A scale whose top step never occurs is a two-step scale wearing a
    # three-step label. This is the guard on the band constants: it fails if a
    # future tweak makes `high` (or `low`) unreachable from plausible history.
    continuous = {
        project([60.0, 64.0, 58.0, 62.0, 61.0, 63.0, 59.0, 60.0]).confidence,
        project([25.0, 60.0, 45.0, 88.0, 12.0, 70.0]).confidence,
        project([10.0, 90.0, 4.0, 120.0, 30.0, 75.0, 2.0, 140.0]).confidence,
    }
    assert continuous == {"high", "medium", "low"}

    counts = {
        # Near-certain zero: a tight belief, correctly `high`.
        project([0.0] * 5 + [1.0], s="receiving_tds", prior=COUNT_PRIOR).confidence,
        # Genuinely spread between 0, 1 and 2.
        project([2.0, 2.0, 0.0, 2.0, 3.0, 1.0],
                s="receiving_tds", prior=COUNT_PRIOR).confidence,
        # Boom-or-bust receptions: wide enough on its own scale to be `low`.
        project([1.0, 11.0, 2.0, 9.0, 0.0, 12.0, 1.0, 10.0],
                s="receptions", prior=RECEPTION_PRIOR).confidence,
    }
    assert counts == {"high", "medium", "low"}


def test_count_confidence_is_not_inverted_by_its_own_mean() -> None:
    # Dividing a count interval by its own mean inverts the scale: a tight end
    # projected at 0.6 touchdowns spans 0-2 (ratio 3.3) while one projected at
    # 0.2 spans 0-1 (ratio 2.0), making the better-evidenced player read as
    # less confident. The +1 offset measures against "about one event", which
    # is the scale these stats live on.
    busy = project([1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0],
                   s="receiving_tds", prior=COUNT_PRIOR)
    quiet = project([0.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    s="receiving_tds", prior=COUNT_PRIOR)

    assert busy.projected_value > quiet.projected_value
    # The quiet player's belief is genuinely tighter — P(zero) is near certain
    # — so a higher confidence there is correct, not a bug. What must NOT
    # happen is the width metric growing merely because the mean grew.
    assert busy.relative_width < 3.0
    assert quiet.relative_width < busy.relative_width


def test_long_career_in_a_new_role_does_not_buy_confidence() -> None:
    # n_eff counts eligible games in the current role. A player with a long
    # career and three eligible games must not read `high` because the career
    # is long — the confidence rule never sees the career.
    result = project([31.0, 44.0, 28.0])
    assert result.confidence != CONFIDENCE_HIGH
    assert result.n_eff == 3


def test_returning_from_absence_is_flagged_not_hidden() -> None:
    result = project([55.0, 60.0, 48.0, 70.0], gap_weeks=9)
    assert COHORT_RETURNING in result.cohorts


# --- Family behaviour --------------------------------------------------------


def test_count_stat_emits_an_explicit_pmf_with_visible_zero_mass() -> None:
    result = project(
        [0.0] * 11 + [1.0], s="receiving_tds", prior=COUNT_PRIOR
    )
    assert result.distribution_kind == "negative_binomial"
    assert result.pmf and len(result.pmf) == spec("receiving_tds").pmf_cap + 1
    assert result.zero_mass and result.zero_mass > 0.5
    assert result.tail_mass is not None and result.tail_mass >= 0.0
    assert sum(result.pmf) + result.tail_mass == pytest.approx(1.0, abs=1e-9)


def test_continuous_stat_never_places_mass_below_zero() -> None:
    for values in ([0.0, 0.0, 4.0], [1.0], [300.0, 12.0, 0.0, 45.0]):
        result = project(values)
        assert result.mass_below_zero == 0.0
        assert "impossible_output" not in result.cohorts
        assert result.interval_low >= 0.0


def test_negative_yardage_is_inflation_mass_not_vanished_weight() -> None:
    # Regression (review fix): a negative actual — routine in rushing and
    # receiving yardage — matched neither the zero branch (v == 0.0) nor the
    # log-normal branch (v > 0.0), so its weight silently vanished from the
    # mixture and survival probabilities were overstated. The rule is now:
    # non-positive production is inflation mass, matching lognormal_moments.
    from sightline_model.constants import HALF_LIFE_GAMES
    from sightline_model.projection import _fit_continuous

    window = [-3.0, -1.0, 2.0, -2.0, 5.0, -1.0, 1.0, -2.0]
    dist, _ = _fit_continuous(history(window), CONT_PRIOR)

    # Independent recomputation: exponentially-weighted share of <= 0 games,
    # shrunk toward the prior with weight K0.
    raw = [0.5 ** (age / HALF_LIFE_GAMES) for age in range(len(window) - 1, -1, -1)]
    total = sum(raw)
    share = sum(w / total for w, v in zip(raw, window) if v <= 0.0)
    n = len(window)
    expected_p_zero = (n * share + K0 * CONT_PRIOR.p_zero) / (n + K0)

    assert dist.p_zero == pytest.approx(expected_p_zero, abs=1e-12)
    # Five of eight games produced nothing positive; under the old bug the
    # sample contribution was 0.0 and the fitted p_zero collapsed to ~0.04.
    assert dist.p_zero > 0.4
    # And the survival probability must be consistent with that mass: at most
    # the weight of positive production, nowhere near the old overstated value.
    assert dist.prob_at_least(0.5) <= 1.0 - dist.p_zero + 1e-12
    assert dist.prob_at_least(0.5) < 0.6


def test_all_zero_history_is_projectable_not_an_error() -> None:
    # A tight end with four eligible games and no receiving yards is a real
    # player. The projection should be small and heavy at zero, not a crash.
    result = project([0.0, 0.0, 0.0, 0.0])
    assert isinstance(result, ProjectionResult)
    assert result.projected_value < 30.0
    assert result.params["p_zero"] > 0.5


def test_count_stat_with_no_history_and_a_zero_prior_still_fits() -> None:
    empty_prior = Prior(
        season=2023, stat_type="rushing_tds", position="WR",
        fitted_from_seasons=(2022,), sample_games=10, sample_players=3,
        mean=0.0, variance=0.0,
    )
    result = project([0.0, 0.0], s="rushing_tds", prior=empty_prior)
    assert isinstance(result, ProjectionResult)
    assert result.zero_mass and result.zero_mass > 0.99


# --- Shrinkage consistency ---------------------------------------------------


def test_prior_weight_matches_the_documented_rule() -> None:
    result = project([70.0, 70.0, 70.0, 70.0])
    weight = K0 / (4 + K0)
    assert f"{weight * 100:.0f}%" in result.drivers[1]
