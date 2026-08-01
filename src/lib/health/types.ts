/**
 * Health signal states.
 *
 * A **TypeScript union, not a database enum** — no health row is persisted.
 * The three signals are produced by a server-side resolver from a static
 * registry (SIG-37), and Pitch 5 replaces that registry with real values.
 *
 * Six states exist so four different kinds of "unavailable" never collapse into
 * one. Rendering a not-built job as though it merely failed, or a failed read
 * as though the job does not exist, is the false reporting this surface exists
 * to prevent.
 */
export type HealthSignalState =
  | "not_yet_implemented" // the job does not exist in this version
  | "never_run" // implemented, no successful run recorded
  | "not_expected" // outside the season, or outside its scheduled window
  | "ok" // last success inside expected bounds
  | "late" // last success outside expected bounds
  | "failed"; // last run failed
