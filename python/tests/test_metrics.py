"""Aggregates, calibration bins, and digests (SIG-18).

The properties that matter here are the ones whose violation would be
invisible: an aggregate that depends on how the run was chunked, a metric
reported as zero when it was never computed, a bin that claims a larger sample
than it has, and a digest that agrees with a summary the raw rows contradict.
"""

from __future__ import annotations

import math

import polars as pl
import pytest

from sightline_model.constants import (
    CONTRACT_LIKE_FLOORS,
    REPORTING_FLOOR,
    is_contract_like,
)
from sightline_model.harness import RunTotals
from sightline_model.metrics import (
    AGGREGATES_VERSION,
    aggregate_digest,
    compute_aggregates,
    compute_calibration_bins,
    summarise,
)


def _predictions(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(rows, strict=False)


def _totals(**kwargs) -> RunTotals:
    return RunTotals(**kwargs)


BASE = {
    "stat_type": "receiving_yards",
    "season": 2023,
    "weather_era": "archived_forecast",
    "in_comparison_population": True,
}


def _row(abs_error, season_avg_err, trailing_err, **overrides):
    row = {
        **BASE,
        "abs_error": abs_error,
        "sq_error": abs_error**2,
        "baseline_season_avg_abs_error": season_avg_err,
        "baseline_trailing5_abs_error": trailing_err,
    }
    row.update(overrides)
    return row


# --- Aggregates ---------------------------------------------------------------


def test_model_and_both_baselines_share_the_comparison_population() -> None:
    frame = _predictions([_row(10.0, 20.0, 15.0), _row(20.0, 30.0, 25.0)])
    aggregates = compute_aggregates(frame, pl.DataFrame(), _totals(projected=2))
    comparison = aggregates["overall"]["comparison"]

    assert comparison["model"]["n"] == 2
    assert comparison["seasonAverage"]["n"] == 2
    assert comparison["trailingFive"]["n"] == 2
    assert comparison["model"]["mae"] == pytest.approx(15.0)
    assert comparison["seasonAverage"]["mae"] == pytest.approx(25.0)


def test_model_only_population_keeps_predictions_a_baseline_dropped() -> None:
    # Week 1: no season average. The prediction is still the model's work and
    # is reported, just not compared.
    frame = _predictions([
        _row(10.0, 20.0, 15.0),
        _row(40.0, None, None, in_comparison_population=False),
    ])
    aggregates = compute_aggregates(frame, pl.DataFrame(), _totals(projected=2))

    assert aggregates["population"]["comparison"] == 1
    assert aggregates["population"]["modelOnly"] == 2
    assert aggregates["overall"]["comparison"]["model"]["n"] == 1
    assert aggregates["overall"]["modelOnly"]["model"]["n"] == 2
    # And the two must not be conflated: the model-only MAE includes the miss.
    assert (
        aggregates["overall"]["modelOnly"]["model"]["mae"]
        > aggregates["overall"]["comparison"]["model"]["mae"]
    )


def test_a_metric_that_was_not_computed_is_absent_not_zero() -> None:
    frame = _predictions([
        _row(10.0, None, None, in_comparison_population=False)
    ])
    aggregates = compute_aggregates(frame, pl.DataFrame(), _totals(projected=1))
    comparison = aggregates["overall"]["comparison"]
    assert "seasonAverage" not in comparison
    assert "trailingFive" not in comparison
    # A zero here would be read as a measurement.


def test_breakouts_cover_stat_type_season_and_era() -> None:
    frame = _predictions([
        _row(10.0, 20.0, 15.0),
        _row(30.0, 40.0, 35.0, stat_type="rushing_yards", season=2019,
             weather_era="reanalysis"),
    ])
    aggregates = compute_aggregates(frame, pl.DataFrame(), _totals(projected=2))

    assert set(aggregates["byStatType"]) == {"receiving_yards", "rushing_yards"}
    assert set(aggregates["bySeason"]) == {"2019", "2023"}
    assert set(aggregates["byEra"]) == {"archived_forecast", "reanalysis"}


def test_the_reanalysis_caveat_travels_with_the_numbers() -> None:
    frame = _predictions([_row(10.0, 20.0, 15.0, weather_era="reanalysis")])
    aggregates = compute_aggregates(frame, pl.DataFrame(), _totals(projected=1))
    assert aggregates["notes"]["reanalysisLeakAccepted"] is True
    assert "reanalysis" in aggregates["byEra"]


def test_aggregates_are_invariant_to_chunking() -> None:
    # Floating-point addition is not associative. A metric summed in arrival
    # order would differ between a run that wrote one part file and one that
    # wrote thirty-seven; sorting and using fsum removes the difference.
    rows = [_row(float(i) * 0.1, float(i) * 0.2, float(i) * 0.15) for i in range(200)]
    whole = compute_aggregates(_predictions(rows), pl.DataFrame(), _totals(projected=200))
    shuffled = compute_aggregates(
        _predictions(list(reversed(rows))), pl.DataFrame(), _totals(projected=200)
    )
    assert aggregate_digest(whole) == aggregate_digest(shuffled)


def test_aggregates_carry_their_version() -> None:
    aggregates = compute_aggregates(
        _predictions([_row(1.0, 2.0, 3.0)]), pl.DataFrame(), _totals(projected=1)
    )
    assert aggregates["aggregatesVersion"] == AGGREGATES_VERSION


def test_point_estimates_report_both_mean_and_median() -> None:
    # SIG-28: the comparison block (mean) is unchanged; a supplementary
    # pointEstimates block reports the median alongside the mean, NOT as a
    # head-to-head against the mean-based baselines.
    frame = _predictions([
        _row(10.0, 20.0, 15.0, abs_error_median=6.0, sq_error_median=36.0),
        _row(20.0, 30.0, 25.0, abs_error_median=8.0, sq_error_median=64.0),
    ])
    overall = compute_aggregates(frame, pl.DataFrame(), _totals(projected=2))["overall"]
    assert overall["pointEstimates"]["mean"]["mae"] == pytest.approx(15.0)
    assert overall["pointEstimates"]["mean"]["mae"] == overall["comparison"]["model"]["mae"]
    assert overall["pointEstimates"]["median"]["mae"] == pytest.approx(7.0)
    assert overall["pointEstimates"]["median"]["n"] == 2


# --- Thresholds and calibration ----------------------------------------------


def _thresholds(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(rows, strict=False)


def _threshold_row(pid: str, probability: float, outcome: bool, **overrides):
    row = {
        "prediction_id": pid,
        "stat_type": "receiving_yards",
        "season": 2023,
        "weather_era": "archived_forecast",
        "threshold": 74.5,
        "probability": probability,
        "outcome": outcome,
    }
    row.update(overrides)
    return row


def test_brier_is_recomputable_from_the_stored_rows() -> None:
    rows = [
        _threshold_row("p1", 0.8, True),
        _threshold_row("p1", 0.2, False),
        _threshold_row("p2", 0.6, False),
    ]
    aggregates = compute_aggregates(
        pl.DataFrame(), _thresholds(rows), _totals(projected=2)
    )
    expected = ((0.8 - 1) ** 2 + (0.2 - 0) ** 2 + (0.6 - 0) ** 2) / 3
    assert aggregates["overall"]["thresholds"]["brier"] == pytest.approx(expected)


def test_threshold_block_reports_both_sample_sizes() -> None:
    rows = [
        _threshold_row("p1", 0.8, True),
        _threshold_row("p1", 0.2, False),
        _threshold_row("p2", 0.6, False),
    ]
    block = compute_aggregates(
        pl.DataFrame(), _thresholds(rows), _totals(projected=2)
    )["overall"]["thresholds"]
    assert block["observations"] == 3
    assert block["projections"] == 2
    # The smaller one is the effective sample; reporting only the larger would
    # overstate it by however many thresholds are evaluated per distribution.


def test_bins_carry_both_counts_and_the_floor_flag() -> None:
    rows = [_threshold_row(f"p{i}", 0.05, i % 3 == 0) for i in range(20)]
    bins = compute_calibration_bins(_thresholds(rows))
    overall = [b for b in bins if b["stat_type"] is None and b["season"] is None
               and b["era"] is None]
    assert overall
    first = overall[0]
    assert first["threshold_observations"] == 20
    assert first["projection_count"] == 20
    assert first["projection_count"] <= first["threshold_observations"]
    assert first["below_floor"] is True  # 20 < REPORTING_FLOOR
    assert REPORTING_FLOOR > 20


def test_sparse_bins_are_stored_not_dropped() -> None:
    rows = [_threshold_row("p1", 0.95, True)]
    bins = compute_calibration_bins(_thresholds(rows))
    assert bins, "a sparse bin must be stored and flagged, never hidden"
    assert all(b["below_floor"] for b in bins)


def test_segments_are_single_axis() -> None:
    # What the partial unique indexes from SIG-13 enforce. Cross-axis slices
    # are derived from the artefacts on demand, so the durable bin count stays
    # proportional to the axes rather than their product.
    rows = [
        _threshold_row("p1", 0.35, True),
        _threshold_row("p2", 0.45, False, stat_type="rushing_yards",
                       season=2019, weather_era="reanalysis"),
    ]
    for row in compute_calibration_bins(_thresholds(rows)):
        axes = sum(
            1 for key in ("stat_type", "season", "era") if row[key] is not None
        )
        assert axes <= 1, row


def test_bin_boundaries_are_half_open_except_the_last() -> None:
    rows = [
        _threshold_row("p1", 0.10, True),   # -> bin 1
        _threshold_row("p2", 1.00, True),   # -> bin 9, inclusive upper edge
    ]
    bins = {
        b["bin_index"] for b in compute_calibration_bins(_thresholds(rows))
        if b["stat_type"] is None and b["season"] is None and b["era"] is None
    }
    assert bins == {1, 9}


def test_probabilities_and_rates_stay_within_bounds() -> None:
    rows = [_threshold_row(f"p{i}", i / 20, i % 2 == 0) for i in range(1, 20)]
    for row in compute_calibration_bins(_thresholds(rows)):
        assert 0.0 <= row["predicted_mean"] <= 1.0
        assert 0.0 <= row["observed_rate"] <= 1.0
        assert row["bin_low"] < row["bin_high"]


# --- Digests ------------------------------------------------------------------


def test_summarise_produces_stable_digests() -> None:
    predictions = _predictions([_row(10.0, 20.0, 15.0)])
    thresholds = _thresholds([_threshold_row("p1", 0.4, True)])
    a = summarise(predictions, thresholds, _totals(projected=1))
    b = summarise(predictions, thresholds, _totals(projected=1))
    assert a.aggregate_digest == b.aggregate_digest
    assert a.calibration_digest == b.calibration_digest


def test_a_tampered_aggregate_changes_its_digest() -> None:
    predictions = _predictions([_row(10.0, 20.0, 15.0)])
    summary = summarise(predictions, pl.DataFrame(), _totals(projected=1))
    tampered = dict(summary.aggregates)
    tampered["overall"] = dict(tampered["overall"])
    tampered["overall"]["comparison"] = dict(tampered["overall"]["comparison"])
    tampered["overall"]["comparison"]["model"] = {
        **tampered["overall"]["comparison"]["model"], "mae": 9.99,
    }
    assert aggregate_digest(tampered) != summary.aggregate_digest


def test_log_loss_is_finite_at_the_extremes() -> None:
    # A confident prediction that was wrong must not produce infinity and take
    # the whole aggregate with it.
    rows = [_threshold_row("p1", 1.0, False), _threshold_row("p2", 0.0, True)]
    block = compute_aggregates(
        pl.DataFrame(), _thresholds(rows), _totals(projected=2)
    )["overall"]["thresholds"]
    assert math.isfinite(block["logLoss"])
    assert block["brier"] == pytest.approx(1.0)


def test_calibration_is_unchanged_by_the_median_point_estimate() -> None:
    # SIG-28 touches only the point estimate. The calibration curve is derived
    # from the threshold rows alone, so it must be byte-identical whether or not
    # predictions carry the new median columns — the guarantee the amendment
    # rests on.
    thresholds = _thresholds([
        _threshold_row("p1", 0.8, True), _threshold_row("p1", 0.2, False),
        _threshold_row("p2", 0.6, False), _threshold_row("p2", 0.95, True),
    ])
    without = summarise(
        _predictions([_row(10.0, 20.0, 15.0)]), thresholds, _totals(projected=1)
    )
    with_median = summarise(
        _predictions([_row(10.0, 20.0, 15.0, abs_error_median=6.0, sq_error_median=36.0)]),
        thresholds, _totals(projected=1),
    )
    assert with_median.calibration_digest == without.calibration_digest
    assert with_median.bins == without.bins


# --- SIG-26: contract-like population segment ---------------------------------


def test_contract_like_membership_is_a_pure_function_of_projected_value() -> None:
    # The leakage guard: membership depends only on the projected value (which
    # derives from pre-cutoff information) and the stat's floor — never on the
    # outcome. This is why the segment can be trusted to fit sizing against.
    assert is_contract_like("receiving_yards", 25.0) is True
    assert is_contract_like("receiving_yards", 19.9) is False
    assert is_contract_like(
        "receiving_yards", CONTRACT_LIKE_FLOORS["receiving_yards"]
    ) is True
    # A stat with no floor is never contract-like.
    assert is_contract_like("no_such_stat", 10_000.0) is False


def test_contract_like_floor_sensitivity_is_reproducible() -> None:
    # 0.5x / 1x / 2x move the boundary deterministically — the sensitivity the
    # report requires, recomputable from the projected value on the row.
    floor = CONTRACT_LIKE_FLOORS["receiving_yards"]  # 20
    assert is_contract_like("receiving_yards", 12.0, multiple=0.5) is True   # floor 10
    assert is_contract_like("receiving_yards", 12.0, multiple=1.0) is False  # floor 20
    assert is_contract_like("receiving_yards", floor * 2 - 0.1, multiple=2.0) is False


def test_contract_like_is_a_stored_calibration_segment() -> None:
    rows = (
        [_threshold_row(f"p{i}", 0.85, i % 4 != 0, contract_like=True) for i in range(12)]
        + [_threshold_row(f"q{i}", 0.05, False, contract_like=False) for i in range(12)]
    )
    bins = compute_calibration_bins(_thresholds(rows))
    # The POOLED contract-like segment (no stat axis) pools ONLY the 12
    # contract-like thresholds, never the rest. (A per-stat contract-like
    # segment also exists — covered by its own test.)
    pooled = [
        b for b in bins
        if b["population"] == "contract_like" and b["stat_type"] is None
    ]
    assert pooled
    assert sum(b["threshold_observations"] for b in pooled) == 12


def test_contract_like_is_stored_per_stat_type_too() -> None:
    # The one sanctioned two-axis segment: contract-like × stat type, because
    # miscalibration differs by stat and the recalibration layer corrects per
    # stat. Pooled and per-stat contract-like segments coexist.
    rows = (
        [_threshold_row(f"r{i}", 0.85, True, contract_like=True,
                        stat_type="receiving_yards") for i in range(11)]
        + [_threshold_row(f"t{i}", 0.85, False, contract_like=True,
                          stat_type="rushing_tds") for i in range(11)]
    )
    bins = compute_calibration_bins(_thresholds(rows))
    pooled = [b for b in bins if b["population"] == "contract_like"
              and b["stat_type"] is None]
    per_stat = {
        b["stat_type"] for b in bins
        if b["population"] == "contract_like" and b["stat_type"] is not None
    }
    assert pooled  # the pooled contract-like segment still exists
    assert per_stat == {"receiving_yards", "rushing_tds"}


def test_contract_like_aggregate_block_carries_brier_over_only_its_rows() -> None:
    thresholds = _thresholds([
        _threshold_row("p1", 0.8, True, contract_like=True),
        _threshold_row("p1", 0.2, False, contract_like=True),
        _threshold_row("p2", 0.5, False, contract_like=False),
    ])
    agg = compute_aggregates(pl.DataFrame(), thresholds, _totals(projected=2))
    assert "brier" in agg["contractLike"]["thresholds"]
    assert agg["contractLike"]["thresholds"]["observations"] == 2  # not the 3rd row
