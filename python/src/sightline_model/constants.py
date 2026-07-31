"""The engine's resolved constants.

Everything here is hashed into ``BacktestRun.engine_config_digest`` and stored
in ``engine_config``, so a stored run remains interpretable after the code
changes. Changing any value here changes what the model is, and therefore
requires a new ``MODEL_VERSION`` — two runs that share a model version and
disagree on a constant are two different experiments wearing one name.
"""

from __future__ import annotations

MODEL_VERSION = "baseline-zil-0.1.0"

# --- Form window -----------------------------------------------------------
# Exponentially weighted over the most recent eligible games. Ages are counted
# in ELIGIBLE GAMES, not calendar weeks: a player who missed four weeks has a
# four-week-old last game, not a four-game-old one, and treating those the same
# would silently discount everyone returning from absence.
TRAILING_WINDOW = 8
HALF_LIFE_GAMES = 4.0

# --- Shrinkage -------------------------------------------------------------
# Prior weight in games. K0 = 4 means a player with four eligible games is
# weighted equally against the population prior for their position.
K0 = 4.0

# --- Distribution fitting ---------------------------------------------------
# Floor on the log-scale dispersion. Without it, three near-identical games
# produce an interval narrow enough to be physically absurd, and the
# confidence rule would then read that narrowness as certainty.
SIGMA_FLOOR = 0.35

# When a count sample is under-dispersed (variance <= mean), the negative
# binomial has no valid fit. Nudging the variance just above the mean keeps r
# finite and positive; the alternative is a Poisson special case, which would
# mean two distribution families for one stat family.
COUNT_MIN_DISPERSION = 1.05

# --- Confidence -------------------------------------------------------------
# Confidence is an ordinal label, NOT a calibrated probability, and no surface
# may present it as one. It combines two signals the PRD names: how wide the
# interval is relative to the projection, and how much relevant history the
# player has in the current role.
#
# The rule is evaluated in order, first match wins:
#   n_eff < MIN_HISTORY_FOR_MEDIUM   -> low
#   relative width > W_LOW           -> low
#   n_eff >= N_FOR_HIGH and w <= W_HIGH -> high
#   otherwise                        -> medium
MIN_HISTORY_FOR_MEDIUM = 3
N_FOR_HIGH = 6

# Per family, and not merely with different numbers: the two families need
# different DENOMINATORS, because relative width is degenerate for low counts.
#
# Continuous: width / max(projected, floor). The floor stops a 2-yard
# projection producing an enormous ratio from a 4-yard interval.
#
# Count: width / (offset + projected). Dividing a count interval by its own
# mean inverts the scale — a tight end projected at 0.6 touchdowns spans
# 0 to 2 (ratio 3.3) while one projected at 0.2 spans 0 to 1 (ratio 2.0), so
# the better-evidenced, higher-usage player reads as LESS confident. The +1
# offset measures the interval against "about one event", which is the scale
# these stats actually live on.
#
# The bands are calibrated so that all three levels are reachable from
# plausible history — a scale whose top step never occurs is a two-step scale
# wearing a three-step label, and there is a test asserting all three occur.
CONFIDENCE_BANDS = {
    "continuous_nonneg": {"w_high": 1.45, "w_low": 2.00, "floor": 10.0, "offset": 0.0},
    "count": {"w_high": 1.10, "w_low": 1.50, "floor": 0.0, "offset": 1.0},
}

# Zero eligible games is not a wide projection, it is no projection. The engine
# declines rather than emitting a confident-looking population prior.
MIN_ELIGIBLE_GAMES = 1

# A player whose most recent eligible game is this many weeks back is flagged
# `returning` — not excluded, but worth inspecting by hand.
RETURNING_ABSENCE_WEEKS = 5

# --- Threshold policy -------------------------------------------------------
THRESHOLD_POLICY_VERSION = "grid-v1"

# --- Cutoff policy ----------------------------------------------------------
CUTOFF_POLICY = "kickoff_minus_90m/v1"
CUTOFF_MINUTES_BEFORE_KICKOFF = 90
# The kickoff a person believed a week out, used with the actual kickoff to
# derive a conservative cutoff. For a cutoff, resolving EARLIER is the safe
# direction — the mirror image of known_at, where resolving later is safe.
CUTOFF_SCHEDULE_LOOKBACK_DAYS = 7

# --- Grading ----------------------------------------------------------------
# The backtest grades against the official corrected line: it measures how well
# the model predicted what happened, and the corrected line is the best
# evidence of what happened. Whether settlement or the official line is truth
# for grading a POSITION is a different question and is not decided here.
GRADING_TARGET = "official_corrected"

# --- Contract-like population (SIG-26) --------------------------------------
# Kalshi lists contracts only for players with meaningful expected volume. The
# calibration curve that the recalibration layer (autonomous paper trading) is
# fitted against must be segmented to that population, so it is stored as a
# first-class calibration segment rather than recomputed ad hoc.
#
# The floor is applied to `projected_value`, which is derived entirely from
# pre-cutoff information and never conditions on the outcome — so segment
# membership is a pure function of pre-cutoff state (asserted by a leakage
# test), mirroring the real product boundary.
#
# PROVISIONAL. These are a documented default, reported with 0.5x/1x/2x
# sensitivity. They MUST be re-anchored against Kalshi's real listing behaviour
# before the paper run, because the floor defines the population the
# recalibration layer is fitted on.
CONTRACT_LIKE = "contract_like"
CONTRACT_LIKE_FLOORS: dict[str, float] = {
    "passing_yards": 100.0,
    "rushing_yards": 20.0,
    "receiving_yards": 20.0,
    "receptions": 2.0,
    "rushing_tds": 0.2,
    "receiving_tds": 0.2,
}


def is_contract_like(stat_type: str, projected_value: float, *, multiple: float = 1.0) -> bool:
    """Whether a projection clears the volume floor for its stat type.

    ``multiple`` scales every floor for the 0.5x/1x/2x sensitivity report; the
    stored segment uses 1x. A stat with no floor is never contract-like.
    """
    floor = CONTRACT_LIKE_FLOORS.get(stat_type)
    if floor is None:
        return False
    return projected_value >= floor * multiple


# --- Calibration ------------------------------------------------------------
CALIBRATION_BINS = 10
# Threshold observations below which a bin cannot support a claim. Bins below
# it are stored and displayed, flagged, and excluded from summary sentences.
REPORTING_FLOOR = 1_000

# --- Evaluation windows -----------------------------------------------------
# Fixed so that selection pressure against a reporting period is countable.
# Development spans both weather eras deliberately, so the era split is
# exercised from the first run.
EVALUATION_WINDOWS = {
    "development": (2016, 2021),
    "validation": (2022, 2023),
    "holdout": (2024, 2025),
}

# The season from which archived forecasts exist. Earlier seasons fall back to
# reanalysis, which describes what the weather actually was — an accepted and
# reported leak, never silently averaged away.
ARCHIVED_FORECAST_FROM_SEASON = 2021


def engine_config() -> dict[str, object]:
    """The resolved constant set, in a stable key order for hashing."""
    return {
        "modelVersion": MODEL_VERSION,
        "trailingWindow": TRAILING_WINDOW,
        "halfLifeGames": HALF_LIFE_GAMES,
        "k0": K0,
        "sigmaFloor": SIGMA_FLOOR,
        "minHistoryForMedium": MIN_HISTORY_FOR_MEDIUM,
        "nForHigh": N_FOR_HIGH,
        "confidenceBands": CONFIDENCE_BANDS,
        "minEligibleGames": MIN_ELIGIBLE_GAMES,
        "returningAbsenceWeeks": RETURNING_ABSENCE_WEEKS,
        "countMinDispersion": COUNT_MIN_DISPERSION,
        "thresholdPolicyVersion": THRESHOLD_POLICY_VERSION,
        "cutoffPolicy": CUTOFF_POLICY,
        "cutoffMinutesBeforeKickoff": CUTOFF_MINUTES_BEFORE_KICKOFF,
        "cutoffScheduleLookbackDays": CUTOFF_SCHEDULE_LOOKBACK_DAYS,
        "gradingTarget": GRADING_TARGET,
        "calibrationBins": CALIBRATION_BINS,
        "reportingFloor": REPORTING_FLOOR,
        "archivedForecastFromSeason": ARCHIVED_FORECAST_FROM_SEASON,
        # Provisional; re-anchor against Kalshi listings before the paper run.
        "contractLikeFloors": CONTRACT_LIKE_FLOORS,
    }
