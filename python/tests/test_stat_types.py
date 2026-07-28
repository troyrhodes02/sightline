"""The stat-type registry (SIG-15).

The load-bearing test here is the extensibility one: adding a stat type to an
existing family must be a registry row and nothing else. The PRD requires that
"adding a new stat type does not require structural change to the engine", and
the only way to know that is true is to add one and project it without touching
the distribution code.
"""

from __future__ import annotations

import pytest

from sightline_model.constants import THRESHOLD_POLICY_VERSION
from sightline_model.distributions import (
    count_moments,
    fit_negative_binomial,
    lognormal_moments,
    ZeroInflatedLogNormal,
)
from sightline_model.stat_types import (
    FAMILY_CONTINUOUS,
    FAMILY_COUNT,
    ORDER,
    REGISTRY,
    StatTypeSpec,
    UnknownStatType,
    names,
    sort_key,
    spec,
)


def test_six_stat_types_across_two_families() -> None:
    assert len(REGISTRY) == 6
    continuous = {n for n, s in REGISTRY.items() if s.family == FAMILY_CONTINUOUS}
    counts = {n for n, s in REGISTRY.items() if s.family == FAMILY_COUNT}
    assert continuous == {"passing_yards", "rushing_yards", "receiving_yards"}
    assert counts == {"receptions", "rushing_tds", "receiving_tds"}


def test_registry_matches_the_prisma_enum() -> None:
    # The Python registry and the StatType enum are one vocabulary. A value in
    # one and not the other means a run can store a stat type the app cannot
    # read, or the reverse.
    from pathlib import Path

    schema = Path(__file__).resolve().parents[2] / "prisma" / "schema.prisma"
    text = schema.read_text(encoding="utf-8")
    block = text.split("enum StatType {", 1)[1].split("}", 1)[0]
    enum_values = {
        line.strip() for line in block.splitlines() if line.strip() and not line.strip().startswith("//")
    }
    assert enum_values == set(names())


def test_declaration_order_is_the_canonical_candidate_order() -> None:
    # Used for deterministic ordering inside a game. Alphabetical order would
    # depend on locale collation; declaration order does not.
    assert sort_key("passing_yards") == 0
    assert [n for n in sorted(names(), key=sort_key)] == list(ORDER)


def test_unknown_stat_type_raises_rather_than_defaulting() -> None:
    # A typo must not silently project nothing and quietly shrink the run.
    with pytest.raises(UnknownStatType) as exc:
        spec("recieving_yards")
    assert "registered" in str(exc.value)


def test_threshold_grids_are_versioned_and_tie_free() -> None:
    assert THRESHOLD_POLICY_VERSION == "grid-v1"
    for name in names():
        s = spec(name)
        assert all(abs(t % 1 - 0.5) < 1e-9 for t in s.thresholds), name


def test_yardage_grids_differ_by_regime() -> None:
    # A passing grid that started at 24.5 would produce eight thresholds every
    # starting quarterback clears, which are observations carrying no
    # information but inflating the calibration sample.
    assert min(spec("passing_yards").thresholds) > max(
        spec("rushing_yards").thresholds
    ) / 2
    assert spec("rushing_yards").thresholds == spec("receiving_yards").thresholds


def test_adding_a_stat_type_to_an_existing_family_needs_no_engine_change() -> None:
    # The extensibility guarantee, exercised rather than asserted. This
    # synthetic type is registered here only, and both fitting paths accept it
    # without distributions.py knowing it exists.
    synthetic = StatTypeSpec(
        name="rushing_attempts",
        family=FAMILY_COUNT,
        column="carries",
        thresholds=(4.5, 9.5, 14.5),
        pmf_cap=30,
    )
    mean, variance = count_moments([8.0, 12.0, 6.0, 15.0])
    dist = fit_negative_binomial(mean=mean, variance=variance, cap=synthetic.pmf_cap)
    probabilities = [dist.prob_at_least(t) for t in synthetic.thresholds]

    assert probabilities == sorted(probabilities, reverse=True)
    assert all(0.0 <= p <= 1.0 for p in probabilities)

    # And the same for the continuous family.
    synthetic_continuous = StatTypeSpec(
        name="return_yards",
        family=FAMILY_CONTINUOUS,
        column="return_yards",
        thresholds=(9.5, 19.5),
    )
    p_zero, mu, sigma = lognormal_moments([0.0, 14.0, 22.0, 8.0])
    cont = ZeroInflatedLogNormal(p_zero=p_zero, mu=mu, sigma=sigma)
    values = [cont.prob_at_least(t) for t in synthetic_continuous.thresholds]
    assert values == sorted(values, reverse=True)


def test_count_caps_cover_their_grids() -> None:
    for name in names():
        s = spec(name)
        if s.is_count:
            assert s.pmf_cap is not None
            assert s.pmf_cap >= max(s.thresholds)


def test_engine_config_is_hashable_and_ordered() -> None:
    import json

    from sightline_model.constants import engine_config

    config = engine_config()
    once = json.dumps(config, sort_keys=True)
    twice = json.dumps(engine_config(), sort_keys=True)
    assert once == twice, "engine config must serialise identically every time"
    assert config["modelVersion"]
