"""Resolved constants for the Simulation Engine (``simulation-mc-0.1.0``).

Everything here is hashed into ``BacktestRun.engine_config_digest`` and stored
in ``engine_config``, so a stored simulation run stays interpretable after the
code changes. Changing any value here changes what the model is and therefore
requires a new ``SIMULATION_MODEL_VERSION`` — two runs sharing a model version
but disagreeing on a constant are two experiments wearing one name.

Shared *policy* (cutoff, calibration bins, reporting floor, weather era) is
imported from :mod:`sightline_model.constants` rather than re-declared, so the
two engines can never silently diverge on the discipline they share. Only the
simulation-specific configuration lives here.
"""

from __future__ import annotations

from sightline_model.constants import (
    ARCHIVED_FORECAST_FROM_SEASON,
    CALIBRATION_BINS,
    CUTOFF_MINUTES_BEFORE_KICKOFF,
    CUTOFF_POLICY,
    CUTOFF_SCHEDULE_LOOKBACK_DAYS,
    GRADING_TARGET,
    REPORTING_FLOOR,
    THRESHOLD_POLICY_VERSION,
)

# Model identity. ``<engine>-<core>-<semver>`` matching the baseline convention
# (``baseline-zil-0.1.0``). The run instruction's conceptual ``simulation-v1``
# maps to this concrete string; the application's provenance UI renders it as
# "Simulation Engine" / "SIM" and never shows the raw string. (RD-SIM-1)
SIMULATION_MODEL_VERSION = "simulation-mc-0.1.0"

# --- Simulation volume -----------------------------------------------------
# 5,000 vectorised game draws (RD-6). Enough for stable quantile estimates at
# the stored percentiles, including the 1st and 99th, without threatening the
# sub-minute full-slate target. Part of the versioned config: a change is a
# recorded, reproducible decision, not a silent behaviour change. It is NOT a
# measure of evidence — see the confidence rules.
DRAW_COUNT = 5000

# --- Reproducibility -------------------------------------------------------
# The per-game seed is derived from (game_id, model_version, information_cutoff)
# via BLAKE2b (see :mod:`sightline_model.simulation.seed`). The whole game is
# drawn from one seeded generator so within-game correlation is real; the RNG is
# seeded at the GAME level, not per player. (Determinism R1/R2, RD-SIM-7)
SEED_POLICY = "game_blake2b/v1"

# --- Compact distribution representation (RD-5 / RD-SIM-5) -----------------
# Continuous stats (yardage) are stored as an empirical quantile grid at these
# fixed percentiles; any Kalshi threshold is answered by monotone
# piecewise-linear interpolation on the implied CDF between stored points.
QUANTILE_GRID = (0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)

# Low-count discrete stats are stored as an explicit PMF over ``0..K`` plus one
# aggregated ``(K+1)+`` tail bucket, preserving the large zero mass. ``K`` is
# per stat type: touchdowns are truly low-count (RD-5's literal "0-4 plus 5+"),
# while receptions is a count stat whose listed Kalshi thresholds reach 8.5, so
# it needs support to 15 to keep every threshold answerable (RD-SIM-5).
PMF_SUPPORT: dict[str, int] = {
    "rushing_tds": 4,
    "receiving_tds": 4,
    "receptions": 15,
}

# Distribution kinds the writer stamps on a Projection produced by this engine.
DISTRIBUTION_KIND_QUANTILES = "empirical_quantiles"
DISTRIBUTION_KIND_PMF = "empirical_pmf"

# The stat types stored as a quantile grid vs. an explicit PMF.
CONTINUOUS_STAT_TYPES = ("passing_yards", "rushing_yards", "receiving_yards")
DISCRETE_STAT_TYPES = ("receptions", "rushing_tds", "receiving_tds")

# --- Evidence floor (RD-4) -------------------------------------------------
# Below one relevant historical opportunity (a recorded snap, target, or carry
# establishing the player in this role as of the cutoff), the engine writes a
# ProjectionDecline(insufficient_evidence) rather than a fabricated distribution.
EVIDENCE_FLOOR_OPPORTUNITIES = 1


def pmf_support(stat_type: str) -> int:
    """The PMF cap ``K`` for a discrete stat type; the tail bucket is ``K+1``."""
    try:
        return PMF_SUPPORT[stat_type]
    except KeyError as exc:  # pragma: no cover - guarded by the stat registry
        raise KeyError(
            f"no PMF support configured for stat type {stat_type!r}; "
            f"continuous stats use the quantile grid, not a PMF"
        ) from exc


def engine_config() -> dict[str, object]:
    """The resolved constant set, in a stable key order for hashing."""
    return {
        "modelVersion": SIMULATION_MODEL_VERSION,
        "drawCount": DRAW_COUNT,
        "seedPolicy": SEED_POLICY,
        "quantileGrid": list(QUANTILE_GRID),
        "pmfSupport": dict(sorted(PMF_SUPPORT.items())),
        "distributionKindQuantiles": DISTRIBUTION_KIND_QUANTILES,
        "distributionKindPmf": DISTRIBUTION_KIND_PMF,
        "continuousStatTypes": list(CONTINUOUS_STAT_TYPES),
        "discreteStatTypes": list(DISCRETE_STAT_TYPES),
        "evidenceFloorOpportunities": EVIDENCE_FLOOR_OPPORTUNITIES,
        # Shared policy, imported so the two engines cannot diverge on it.
        "thresholdPolicyVersion": THRESHOLD_POLICY_VERSION,
        "cutoffPolicy": CUTOFF_POLICY,
        "cutoffMinutesBeforeKickoff": CUTOFF_MINUTES_BEFORE_KICKOFF,
        "cutoffScheduleLookbackDays": CUTOFF_SCHEDULE_LOOKBACK_DAYS,
        "gradingTarget": GRADING_TARGET,
        "calibrationBins": CALIBRATION_BINS,
        "reportingFloor": REPORTING_FLOOR,
        "archivedForecastFromSeason": ARCHIVED_FORECAST_FROM_SEASON,
    }
