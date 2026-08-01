/**
 * Health signal states.
 *
 * A **TypeScript union, not a database enum** — no health row is persisted.
 * Every state is derived at read time from run records, the stored schedule,
 * and configured bounds (spec RD-25), then discarded.
 *
 * Six states exist so five different kinds of "not simply fine" never collapse
 * into one. A job outside its season, a job mid-flight, a job that failed, a
 * job that succeeded too long ago, and a job that has never run are five
 * different facts — and the health surface exists precisely so they are not
 * rendered as one shrug. `not_yet_implemented` retired with the live pipeline:
 * every category now has a real recording path behind it.
 */
export type HealthSignalState =
  | "ok" // last success inside expected bounds
  | "running" // an attempt is in flight, inside the run timeout
  | "late" // last success outside expected bounds
  | "failed" // latest attempt failed, was incomplete, or timed out mid-run
  | "never_run" // expected, but no successful run has ever completed
  | "not_expected"; // no scheduled game inside the lookahead (offseason, dark week)
