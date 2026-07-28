"""The two permanent naive baselines.

These are not scaffolding. Every future model has to demonstrate improvement
over arithmetic a person could do in a spreadsheet, and that comparison stays
in Sightline's accuracy reporting for good — which is why they read from the
same eligible history the model reads, through the same cutoff-bounded corpus.
A baseline computed from a different population would make the comparison
meaningless in the flattering direction.

Both are point estimates and get MAE/RMSE only. Neither gets a Brier score:
giving a point estimate a distribution to score would be a modelling decision
this pitch did not scope, and a fabricated one would make the calibration
comparison meaningless.
"""

from __future__ import annotations

from dataclasses import dataclass

from .features import EligibleHistory

TRAILING_N = 5

REASON_BASELINE_UNAVAILABLE = "baseline_unavailable"


@dataclass(frozen=True)
class Baselines:
    """Both baselines for one candidate, either of which may be undefined.

    ``None`` is not zero and is never coerced to one. An undefined baseline
    removes the prediction from the comparison population and nothing else —
    the model's own projection survives in the model-only population, so week 1
    is reported rather than quietly discarded.
    """

    season_average: float | None
    trailing_five: float | None

    @property
    def both_defined(self) -> bool:
        return self.season_average is not None and self.trailing_five is not None


def season_average(history: EligibleHistory, *, season: int) -> float | None:
    """Mean of eligible prior games **in the same season**.

    Undefined before a player's first eligible game of the season, which is
    exactly what "season average" means in week 1 — not zero, and not last
    year's number wearing this year's label.
    """
    values = [v for v, s in zip(history.values, history.seasons) if s == season]
    if not values:
        return None
    return sum(values) / len(values)


def trailing_five(history: EligibleHistory) -> float | None:
    """Mean of at most the five most recent eligible games.

    Deliberately allowed to cross a season boundary: recent form does not
    reset in September, and a baseline that pretended otherwise would be
    undefined for the first four weeks of every season, which is when the
    comparison is most interesting.
    """
    if not history.values:
        return None
    window = history.values[-TRAILING_N:]
    return sum(window) / len(window)


def compute(history: EligibleHistory, *, season: int) -> Baselines:
    return Baselines(
        season_average=season_average(history, season=season),
        trailing_five=trailing_five(history),
    )
