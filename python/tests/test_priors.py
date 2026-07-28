"""Walk-forward priors and shrinkage (SIG-15).

The gating assertion is the walk-forward one: a prior for season S must be
identical whether or not seasons >= S exist in the input. A prior that saw its
own season would encode that season's outcomes into every prediction inside it
— the season-aggregate leak from CLAUDE.md, wearing the costume of a population
parameter, and invisible in a diff because the code looks like ordinary
aggregation.
"""

from __future__ import annotations

import pytest

from sightline_model.constants import K0
from sightline_model.priors import (
    InsufficientPriorEvidence,
    Prior,
    fit_prior,
    prior_weight,
    shrink,
)
from sightline_model.stat_types import spec


def _rows(*, seasons: dict[int, list[float]], players: int = 4) -> list[dict]:
    out: list[dict] = []
    for season, values in seasons.items():
        for i, value in enumerate(values):
            out.append(
                {"season": season, "player_id": f"p{i % players}", "value": value}
            )
    return out


def test_prior_is_identical_with_and_without_later_seasons() -> None:
    # The walk-forward guarantee, asserted directly rather than by inspection.
    earlier = {2019: [40.0, 62.0, 71.0, 0.0], 2020: [55.0, 80.0, 12.0]}
    with_future = {**earlier, 2021: [900.0] * 20, 2022: [1200.0] * 20}

    without = fit_prior(_rows(seasons=earlier), season=2021,
                        spec=spec("receiving_yards"), position="WR")
    with_ = fit_prior(_rows(seasons=with_future), season=2021,
                      spec=spec("receiving_yards"), position="WR")

    assert without == with_, (
        "the prior for 2021 changed when 2021+ data was present — it is "
        "reading the season it is used to predict"
    )


def test_prior_records_the_evidence_behind_it() -> None:
    prior = fit_prior(
        _rows(seasons={2019: [40.0, 62.0], 2020: [55.0, 80.0]}, players=2),
        season=2021, spec=spec("receiving_yards"), position="WR",
    )
    assert prior.fitted_from_seasons == (2019, 2020)
    assert prior.sample_games == 4
    assert prior.sample_players == 2
    # A prior drawn from four player-games is a different object from one drawn
    # from four thousand, and the difference must be visible without refitting.


def test_prior_for_a_count_stat_carries_moments_not_lognormal_params() -> None:
    prior = fit_prior(
        _rows(seasons={2019: [0.0, 0.0, 1.0, 2.0]}),
        season=2020, spec=spec("receiving_tds"), position="TE",
    )
    assert prior.mean is not None and prior.variance is not None
    assert prior.mu is None and prior.p_zero is None


def test_prior_for_a_continuous_stat_carries_lognormal_params() -> None:
    prior = fit_prior(
        _rows(seasons={2019: [0.0, 30.0, 60.0, 90.0]}),
        season=2020, spec=spec("rushing_yards"), position="RB",
    )
    assert prior.p_zero == pytest.approx(0.25)
    assert prior.mu is not None and prior.sigma is not None
    assert prior.mean is None


def test_missing_earlier_evidence_raises_rather_than_substituting() -> None:
    # A fabricated prior would flow into every projection for the position and
    # be invisible in the aggregate.
    with pytest.raises(InsufficientPriorEvidence):
        fit_prior(
            _rows(seasons={2021: [40.0, 62.0]}),
            season=2021, spec=spec("receiving_yards"), position="WR",
        )


def test_nulls_are_absence_not_zero() -> None:
    # A quarterback's null receiving_yards is not a zero-yard receiving
    # performance, and must not drag the prior's zero rate up.
    rows = _rows(seasons={2019: [60.0, 40.0]})
    rows.append({"season": 2019, "player_id": "px", "value": None})
    prior = fit_prior(rows, season=2020, spec=spec("receiving_yards"), position="WR")
    assert prior.sample_games == 2
    assert prior.p_zero == 0.0


def test_prior_is_frozen() -> None:
    prior = fit_prior(
        _rows(seasons={2019: [40.0]}), season=2020,
        spec=spec("receiving_yards"), position="WR",
    )
    assert isinstance(prior, Prior)
    with pytest.raises(Exception):
        prior.mu = 9.9  # type: ignore[misc]


# --- Shrinkage ---------------------------------------------------------------


def test_shrinkage_weights_prior_and_sample_equally_at_k0() -> None:
    assert shrink(100.0, int(K0), 0.0) == pytest.approx(50.0)


def test_shrinkage_is_prior_dominated_with_one_eligible_game() -> None:
    # The reason a one-game projection can be called `low` confidence without
    # contradicting the number it qualifies: the number is mostly prior.
    assert prior_weight(1) == pytest.approx(K0 / (1 + K0))
    assert prior_weight(1) > 0.5
    assert shrink(200.0, 1, 50.0) == pytest.approx((200.0 + K0 * 50.0) / (1 + K0))


def test_shrinkage_approaches_the_sample_as_history_grows() -> None:
    assert shrink(80.0, 40, 20.0) == pytest.approx(74.5, abs=0.5)
    assert prior_weight(40) < 0.1


def test_shrinkage_with_no_history_is_entirely_prior() -> None:
    assert shrink(999.0, 0, 42.0) == pytest.approx(42.0)
    assert prior_weight(0) == 1.0


def test_negative_history_is_rejected() -> None:
    with pytest.raises(ValueError):
        shrink(1.0, -1, 1.0)
