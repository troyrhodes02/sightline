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
        "countMinDispersion": COUNT_MIN_DISPERSION,
        "thresholdPolicyVersion": THRESHOLD_POLICY_VERSION,
        "cutoffPolicy": CUTOFF_POLICY,
        "cutoffMinutesBeforeKickoff": CUTOFF_MINUTES_BEFORE_KICKOFF,
        "cutoffScheduleLookbackDays": CUTOFF_SCHEDULE_LOOKBACK_DAYS,
        "gradingTarget": GRADING_TARGET,
        "calibrationBins": CALIBRATION_BINS,
        "reportingFloor": REPORTING_FLOOR,
        "archivedForecastFromSeason": ARCHIVED_FORECAST_FROM_SEASON,
    }
