"""The stat-type registry.

Six stat types across two distributional families. **Adding a stat type to an
existing family is a row in this file and a value in the Prisma enum — never a
change to ``distributions.py``.** That is what the PRD's "adding a new stat
type does not require structural change to the engine" means operationally,
and ``tests/test_stat_types.py`` asserts it by registering a synthetic type and
projecting it without touching the distribution code.

Threshold grids are policy, not preference: calibration results depend on which
threshold events were sampled, so the grids are versioned
(``THRESHOLD_POLICY_VERSION``) and named in every calibration output rather
than presented as policy-free facts. They are fixed at ``.5`` values, mirroring
how Kalshi lists thresholds, which also means a threshold can never tie with an
integer outcome.
"""

from __future__ import annotations

from dataclasses import dataclass

# Distribution families. A family determines the fitted distribution, the shape
# of the stored parameters, and the confidence constants — everything a stat
# type does NOT get to decide for itself.
FAMILY_CONTINUOUS = "continuous_nonneg"
FAMILY_COUNT = "count"


@dataclass(frozen=True)
class StatTypeSpec:
    """One predictable quantity."""

    name: str
    family: str
    column: str  # the PlayerGameStat column holding the actual
    thresholds: tuple[float, ...]
    # Count family only: the largest k with an explicit PMF entry. Mass above
    # it is carried in a single tail term rather than truncated away.
    pmf_cap: int | None = None

    @property
    def is_continuous(self) -> bool:
        return self.family == FAMILY_CONTINUOUS

    @property
    def is_count(self) -> bool:
        return self.family == FAMILY_COUNT


def _grid(start: float, stop: float, step: float) -> tuple[float, ...]:
    """An inclusive .5-valued grid. Built with integers to avoid float drift."""
    out = []
    value = start
    while value <= stop + 1e-9:
        out.append(round(value, 1))
        value += step
    return tuple(out)


# Yardage grids sit where real markets sit: a wide spread for passing, a
# tighter one for rushing and receiving.
_PASSING_GRID = _grid(149.5, 349.5, 25.0)
_YARDAGE_GRID = _grid(24.5, 124.5, 10.0)
_RECEPTION_GRID = _grid(1.5, 8.5, 1.0)
# Touchdowns are near-binary in practice; a grid past 1.5 would generate
# threshold events almost none of which ever resolve true, which inflates the
# observation count without adding information.
_TD_GRID = (0.5, 1.5)

REGISTRY: dict[str, StatTypeSpec] = {
    spec.name: spec
    for spec in (
        StatTypeSpec("passing_yards", FAMILY_CONTINUOUS, "passing_yards", _PASSING_GRID),
        StatTypeSpec("rushing_yards", FAMILY_CONTINUOUS, "rushing_yards", _YARDAGE_GRID),
        StatTypeSpec("receiving_yards", FAMILY_CONTINUOUS, "receiving_yards", _YARDAGE_GRID),
        StatTypeSpec("receptions", FAMILY_COUNT, "receptions", _RECEPTION_GRID, pmf_cap=15),
        StatTypeSpec("rushing_tds", FAMILY_COUNT, "rushing_tds", _TD_GRID, pmf_cap=4),
        StatTypeSpec("receiving_tds", FAMILY_COUNT, "receiving_tds", _TD_GRID, pmf_cap=4),
    )
}

# Declaration order. Used as the canonical candidate ordering inside a game, so
# a run's iteration order does not depend on locale string collation.
ORDER = tuple(REGISTRY)


class UnknownStatType(KeyError):
    """Raised rather than defaulting: a typo must not silently project nothing."""


def spec(name: str) -> StatTypeSpec:
    try:
        return REGISTRY[name]
    except KeyError:
        raise UnknownStatType(
            f"unknown stat type {name!r}; registered: {', '.join(ORDER)}"
        ) from None


def names() -> tuple[str, ...]:
    return ORDER


def sort_key(name: str) -> int:
    """Position in declaration order, for deterministic candidate ordering."""
    return ORDER.index(name)
