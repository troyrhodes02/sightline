/**
 * Resolved constants for Adjustment Suggestions & Source Reliability.
 *
 * These mirror the Python values in
 * `python/src/sightline_model/suggestions/constants.py`. The two runtimes share
 * one Postgres database and must agree on what "material", "conflicting", and
 * "enough evidence to report a rate" mean. Change one, change the other.
 *
 * Two of these were NOT specified in the approved planning docs and are this
 * run's chosen defaults, flagged for explicit human review before merge (spec
 * §16): `CONFLICT_WINDOW_MINUTES` and `RELIABILITY_MIN_SAMPLE`.
 */

/**
 * Two contradictory, still-unconfirmed claims on the same
 * `(source, subject, claimType)` identity arriving within this many minutes are
 * treated as CONFLICTING (neither current) rather than a reversal. A claim older
 * than this with no contradiction is "stable"; a later differing value then
 * supersedes it. **Run default — flagged for human review.**
 */
export const CONFLICT_WINDOW_MINUTES = 5;

/**
 * Minimum verifiable observations before a numeric reliability rate is shown.
 * Applied INDEPENDENTLY to Source Accuracy and Adjustment Accuracy — their
 * populations diverge. Below it, the count is shown and the rate withheld.
 * **Run default — flagged for human review.**
 */
export const RELIABILITY_MIN_SAMPLE = 15;

/**
 * A suggestion is raised only when the shadow-adjusted projection would move a
 * LISTED contract's threshold-probability by at least this many percentage
 * points (decision 5).
 */
export const MATERIALITY_THRESHOLD_PP = 3.0;

/**
 * When the affected player has NO listed contract, a suggestion is raised only
 * when the projected value shifts by at least this percent RELATIVE to the base
 * projection (decision 5). Keeps a currently-untradeable but material
 * redistribution visible without generating noise over trivial shifts.
 */
export const MATERIALITY_RELATIVE_PCT = 10.0;
