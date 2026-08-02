/**
 * Reporting bounds for the accuracy surface.
 *
 * Deliberate constants, not environment variables — a floor that differed
 * between environments would make the same grades read provisional in one
 * place and settled in another.
 */

/**
 * A calibration bucket below this many threshold observations renders
 * provisional (hollow point, dashed connection, counts shown) and is excluded
 * from summary sentences. Mirrors `REPORTING_FLOOR` in
 * `python/src/sightline_model/constants.py` and the stored `below_floor`
 * semantics on `CalibrationBin` — the live curve must judge itself by the same
 * floor the backtest record stored, or Compare would be like-for-unlike.
 */
export const REPORTING_FLOOR = 1_000;

/** Ten fixed tenths, matching the stored backtest `binIndex` 0–9 axes. */
export const CALIBRATION_BINS = 10;

/**
 * The market comparison needs this many graded market-linked observations
 * before the headline edge renders; below it, the panel shows its honest
 * insufficient-sample state with the running count (design decision 13).
 */
export const MARKET_MIN_GRADED_OBSERVATIONS = 30;

// The freshness line's delayed-grading bound is NOT defined here: it is
// `GRADING_LATE_AFTER_HOURS` in `src/lib/health/config.ts`, imported by the
// accuracy read so the shared "results may trail recent games" disclosure and
// the admin health signal can never disagree about what "delayed" means. The
// dependency is config-to-config only — the accuracy read never touches the
// health read or its signal states.
