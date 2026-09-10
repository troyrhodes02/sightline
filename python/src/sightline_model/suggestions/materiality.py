"""Materiality: is a proposed change worth interrupting William for? (decision 5)

Pure functions over two compact distributions (the current base projection and
the shadow-adjusted one) plus any listed Kalshi thresholds for the affected
player. A suggestion is raised only when:

* the shadow would move the threshold-probability on **at least one listed
  contract** by ``threshold_pp`` percentage points or more; or
* the player has **no listed contract** and the projected value shifts by
  ``relative_pct`` percent or more relative to the base.

Below both applicable bounds, the redistribution stays inside the model as
ordinary Simulation Engine behaviour and no suggestion is raised.

Threshold probabilities come from the same closed-form helpers the backtest and
the golden-parity fixture use — nothing is re-sampled here, and no price is read
(only ``Contract.threshold``, supplied by the caller).
"""

from __future__ import annotations

from dataclasses import dataclass

from sightline_model.simulation.core import (
    prob_at_least_from_pmf,
    prob_at_least_from_quantiles,
)

# The two kinds this feature reports against, mirroring the schema's
# `materiality_kind` string.
KIND_LISTED_THRESHOLD_PP = "listed_threshold_pp"
KIND_UNLISTED_RELATIVE_PCT = "unlisted_relative_pct"

_RELATIVE_FLOOR = 1e-6  # guards a divide-by-near-zero base projection


@dataclass(frozen=True)
class ProjectionDist:
    """A projection's compact distribution plus its point estimate."""

    quantiles: dict[str, float] | None
    pmf: list[float] | None
    projected_value: float


@dataclass(frozen=True)
class MaterialityResult:
    material: bool
    kind: str
    # Populated for a listed evaluation: the maximum absolute pp shift observed
    # across the player's listed thresholds.
    threshold_pp: float | None
    # Populated for an unlisted evaluation: the relative % shift in projected value.
    relative_pct: float | None


def _prob_at_least(dist: ProjectionDist, threshold: float) -> float:
    """P(X >= threshold) from whichever compact form the projection stored."""
    if dist.quantiles is not None:
        return prob_at_least_from_quantiles(dist.quantiles, threshold)
    if dist.pmf is not None:
        return prob_at_least_from_pmf(dist.pmf, threshold)
    # A projection with neither form cannot support a threshold probability; treat
    # the shift as unmeasurable (0) rather than fabricating one.
    return 0.0


def evaluate_materiality(
    *,
    base: ProjectionDist,
    shadow: ProjectionDist,
    listed_thresholds: list[float],
    threshold_pp: float,
    relative_pct: float,
) -> MaterialityResult:
    """Decide whether the base→shadow change is material (decision 5)."""
    if listed_thresholds:
        max_pp = 0.0
        for t in listed_thresholds:
            shift_pp = abs(_prob_at_least(shadow, t) - _prob_at_least(base, t)) * 100.0
            max_pp = max(max_pp, shift_pp)
        return MaterialityResult(
            material=max_pp >= threshold_pp,
            kind=KIND_LISTED_THRESHOLD_PP,
            threshold_pp=max_pp,
            relative_pct=None,
        )

    denom = max(abs(base.projected_value), _RELATIVE_FLOOR)
    rel = abs(shadow.projected_value - base.projected_value) / denom * 100.0
    return MaterialityResult(
        material=rel >= relative_pct,
        kind=KIND_UNLISTED_RELATIVE_PCT,
        threshold_pp=None,
        relative_pct=rel,
    )
