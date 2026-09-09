"""Simulation Engine foundation: config identity and seed determinism (SIG-66).

These are the reproducibility and versioning guarantees the rest of the engine
rests on. The seed must be a pure function of ``(game_id, model_version,
information_cutoff)`` — no clock, no entropy — and the config must be a stable,
hashable identity so a stored run stays interpretable.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sightline_model.simulation import config
from sightline_model.simulation.seed import derive_seed

_CUTOFF = datetime(2024, 11, 3, 17, 30, tzinfo=timezone.utc)


def test_model_version_is_distinct_from_baseline() -> None:
    from sightline_model.constants import MODEL_VERSION as BASELINE_VERSION

    assert config.SIMULATION_MODEL_VERSION == "simulation-mc-0.1.0"
    assert config.SIMULATION_MODEL_VERSION != BASELINE_VERSION


def test_draw_count_is_the_versioned_five_thousand() -> None:
    assert config.DRAW_COUNT == 5000
    assert config.engine_config()["drawCount"] == 5000


def test_quantile_grid_is_the_nine_point_grid() -> None:
    assert config.QUANTILE_GRID == (
        0.01,
        0.05,
        0.10,
        0.25,
        0.50,
        0.75,
        0.90,
        0.95,
        0.99,
    )
    # Strictly increasing and symmetric about the median — required for the
    # monotone piecewise-linear CDF interpolation the threshold query relies on.
    grid = config.QUANTILE_GRID
    assert list(grid) == sorted(grid)
    assert len(set(grid)) == len(grid)


def test_pmf_support_is_per_stat_and_covers_reception_thresholds() -> None:
    # Touchdowns are truly low-count (RD-5's literal 0-4 plus 5+); receptions
    # is a count stat whose listed Kalshi thresholds reach 8.5, so it needs
    # support past that to keep every threshold answerable (RD-SIM-5).
    assert config.pmf_support("rushing_tds") == 4
    assert config.pmf_support("receiving_tds") == 4
    assert config.pmf_support("receptions") == 15
    # The highest listed reception threshold (8.5 -> requires P(>=9)) must sit
    # strictly inside the explicit support, not in the aggregated tail bucket.
    assert config.pmf_support("receptions") >= 9


def test_continuous_stats_have_no_pmf_support() -> None:
    for stat in config.CONTINUOUS_STAT_TYPES:
        assert stat not in config.PMF_SUPPORT
    # Every discrete stat has a support entry.
    for stat in config.DISCRETE_STAT_TYPES:
        assert stat in config.PMF_SUPPORT


def test_engine_config_is_stable_and_hashable() -> None:
    import json

    first = config.engine_config()
    second = config.engine_config()
    assert first == second
    # Serialisable in a stable key order for the config digest.
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert first["modelVersion"] == config.SIMULATION_MODEL_VERSION


def test_seed_is_deterministic() -> None:
    a = derive_seed("game-1", config.SIMULATION_MODEL_VERSION, _CUTOFF)
    b = derive_seed("game-1", config.SIMULATION_MODEL_VERSION, _CUTOFF)
    assert a == b


def test_seed_varies_with_every_input() -> None:
    base = derive_seed("game-1", config.SIMULATION_MODEL_VERSION, _CUTOFF)
    assert base != derive_seed("game-2", config.SIMULATION_MODEL_VERSION, _CUTOFF)
    assert base != derive_seed("game-1", "baseline-zil-0.1.0", _CUTOFF)
    assert base != derive_seed(
        "game-1", config.SIMULATION_MODEL_VERSION, _CUTOFF + timedelta(minutes=1)
    )


def test_seed_is_a_nonnegative_64_bit_int() -> None:
    seed = derive_seed("game-1", config.SIMULATION_MODEL_VERSION, _CUTOFF)
    assert isinstance(seed, int)
    assert 0 <= seed < 2**64


def test_seed_ignores_how_the_cutoff_datetime_was_spelled() -> None:
    # Equal instants must produce equal seeds regardless of the offset they were
    # spelled with: the seed depends on the instant, not its representation.
    same_instant = datetime(
        2024, 11, 3, 12, 30, 0, tzinfo=timezone(timedelta(hours=-5))
    )
    assert same_instant == _CUTOFF  # 12:30 EST == 17:30 UTC
    assert derive_seed("g", "v", same_instant) == derive_seed("g", "v", _CUTOFF)
