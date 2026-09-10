"""Materiality gating (SIG-75, decision 5). Pure, DB-free."""

from __future__ import annotations

from sightline_model.suggestions.materiality import (
    KIND_LISTED_THRESHOLD_PP,
    KIND_UNLISTED_RELATIVE_PCT,
    ProjectionDist,
    evaluate_materiality,
)

# A continuous (quantile-grid) distribution centred where the caller wants it.
_GRID_KEYS = ("q01", "q05", "q10", "q25", "q50", "q75", "q90", "q95", "q99")


def _quantiles(center: float) -> dict[str, float]:
    # A simple symmetric spread around `center`, enough for P(X>=t) to move as
    # the center moves.
    offsets = (-30, -20, -14, -6, 0, 6, 14, 20, 30)
    return {k: max(center + o, 0.0) for k, o in zip(_GRID_KEYS, offsets)}


def _dist(center: float) -> ProjectionDist:
    return ProjectionDist(quantiles=_quantiles(center), pmf=None, projected_value=center)


def test_large_probability_shift_on_a_listed_contract_is_material() -> None:
    base = _dist(50.0)
    shadow = _dist(75.0)  # a big upward move
    res = evaluate_materiality(
        base=base,
        shadow=shadow,
        listed_thresholds=[74.5],
        threshold_pp=3.0,
        relative_pct=10.0,
    )
    assert res.kind == KIND_LISTED_THRESHOLD_PP
    assert res.material is True
    assert res.threshold_pp is not None and res.threshold_pp >= 3.0


def test_tiny_shift_on_a_listed_contract_is_not_material() -> None:
    base = _dist(50.0)
    shadow = _dist(50.2)  # a trivial nudge
    res = evaluate_materiality(
        base=base,
        shadow=shadow,
        listed_thresholds=[74.5],
        threshold_pp=3.0,
        relative_pct=10.0,
    )
    assert res.kind == KIND_LISTED_THRESHOLD_PP
    assert res.material is False


def test_no_listed_contract_falls_back_to_relative_value_shift() -> None:
    base = _dist(50.0)
    shadow = _dist(60.0)  # +20% relative
    res = evaluate_materiality(
        base=base,
        shadow=shadow,
        listed_thresholds=[],
        threshold_pp=3.0,
        relative_pct=10.0,
    )
    assert res.kind == KIND_UNLISTED_RELATIVE_PCT
    assert res.material is True
    assert res.relative_pct is not None and res.relative_pct >= 10.0


def test_no_listed_contract_small_relative_shift_is_not_material() -> None:
    base = _dist(50.0)
    shadow = _dist(52.0)  # +4% relative, below the 10% floor
    res = evaluate_materiality(
        base=base,
        shadow=shadow,
        listed_thresholds=[],
        threshold_pp=3.0,
        relative_pct=10.0,
    )
    assert res.material is False
