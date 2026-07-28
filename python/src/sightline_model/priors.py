"""Walk-forward population priors, and the shrinkage that uses them.

A prior for season *S* is fitted from seasons **strictly earlier than S**, per
``(season, stat_type, position)``. Two consequences, both deliberate:

* **It cannot leak.** A prior that saw season *S* would encode the season's own
  outcomes into every prediction within it — the season-aggregate leak from
  ``CLAUDE.md``, wearing the costume of a population parameter. The
  walk-forward guarantee is asserted directly: a prior for *S* is identical
  whether or not seasons >= *S* are present in the input.
* **It is refit at season boundaries only**, never per game or per week. That
  makes "the same model version" mean something across a season, and it is
  cheap enough that the alternative buys nothing.

Position comes from ``Player.position`` — roster position, which carries no
team affiliation. Joining current team state to a historical game is the other
classic leak, and the schema makes it unavailable rather than merely discouraged.
"""

from __future__ import annotations

from dataclasses import dataclass

from .constants import K0
from .distributions import count_moments, lognormal_moments
from .stat_types import StatTypeSpec


@dataclass(frozen=True)
class Prior:
    """A fitted population prior, with the evidence behind it.

    ``sample_games`` and ``sample_players`` are retained so a prior can be
    explained without refitting — a prior drawn from eleven player-games is a
    different object from one drawn from eleven thousand, and the difference
    should be visible rather than inferred.
    """

    season: int
    stat_type: str
    position: str
    fitted_from_seasons: tuple[int, ...]
    sample_games: int
    sample_players: int

    # Continuous family
    p_zero: float | None = None
    mu: float | None = None
    sigma: float | None = None

    # Count family
    mean: float | None = None
    variance: float | None = None


class InsufficientPriorEvidence(ValueError):
    """No earlier-season evidence exists for this (stat type, position).

    Raised rather than substituted: a fabricated prior would flow into every
    projection for that position and be invisible in the aggregate.
    """


def fit_prior(
    rows: list[dict],
    *,
    season: int,
    spec: StatTypeSpec,
    position: str,
) -> Prior:
    """Fit from ``rows`` of ``{season, player_id, value}``, earlier seasons only.

    The filter is applied here rather than trusted from the caller. A prior is
    exactly the kind of value that gets computed once, cached, and reused
    across a whole run — so the one place it is built is the place the season
    bound has to hold.
    """
    eligible = [r for r in rows if r["season"] < season and r["value"] is not None]
    if not eligible:
        raise InsufficientPriorEvidence(
            f"no pre-{season} evidence for {spec.name}/{position}"
        )

    values = [float(r["value"]) for r in eligible]
    seasons = tuple(sorted({int(r["season"]) for r in eligible}))
    players = len({r["player_id"] for r in eligible})

    common = {
        "season": season,
        "stat_type": spec.name,
        "position": position,
        "fitted_from_seasons": seasons,
        "sample_games": len(eligible),
        "sample_players": players,
    }

    if spec.is_continuous:
        p_zero, mu, sigma = lognormal_moments(values)
        return Prior(**common, p_zero=p_zero, mu=mu, sigma=sigma)

    mean, variance = count_moments(values)
    return Prior(**common, mean=mean, variance=variance)


def shrink(sample: float, n_eff: int, prior: float, *, k0: float = K0) -> float:
    """Weighted average of a player's own history and the population prior.

    ``k0`` is a prior weight measured in games: at ``n_eff == k0`` the player's
    evidence and the prior count equally. A player with one eligible game is
    therefore mostly prior, which is the honest answer and the reason the
    confidence rule can call that projection ``low`` without contradicting the
    number it qualifies.
    """
    if n_eff < 0:
        raise ValueError(f"n_eff cannot be negative: {n_eff!r}")
    return (n_eff * sample + k0 * prior) / (n_eff + k0)


def prior_weight(n_eff: int, *, k0: float = K0) -> float:
    """The share of the posterior contributed by the prior. Reported as a driver."""
    return k0 / (n_eff + k0)
