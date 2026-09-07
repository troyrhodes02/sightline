import {
  EXECUTION_WINDOW_HOURS,
  PAPER_CYCLE_INTERVAL_MINUTES,
  PRE_KICKOFF_CUTOFF_MINUTES,
} from "./config";

/**
 * The autonomous cycle's server-side cadence decision.
 *
 * The cron fires every ten minutes year-round; THIS module decides what an
 * invocation actually does, per game, from the stored schedule — never from
 * hardcoded season dates. Pure, so the decision table is exhaustively testable,
 * and shaped exactly like `decidePriceRefreshAction` so the two read as one
 * pattern rather than two conventions.
 */

export type PaperCycleAction =
  /** Outside this game's execution window, or its kickoff has passed. */
  | "not_in_window"
  /** Inside the window but past the hard pre-kickoff cutoff. */
  | "past_cutoff"
  /** A cycle for this game ran recently enough. */
  | "coalesced"
  /** Evaluate this game window. */
  | "evaluate";

export function decidePaperCycleAction(inputs: {
  kickoffAt: Date;
  /** Start time of the most recent cycle for THIS game, any outcome. */
  lastCycleStartedAt: Date | null;
  now: Date;
}): PaperCycleAction {
  const { kickoffAt, lastCycleStartedAt, now } = inputs;

  const windowOpensAt =
    kickoffAt.getTime() - EXECUTION_WINDOW_HOURS * 60 * 60 * 1000;
  const cutoffAt = kickoffAt.getTime() - PRE_KICKOFF_CUTOFF_MINUTES * 60_000;

  if (now.getTime() < windowOpensAt) return "not_in_window";

  // Past the cutoff is reported distinctly from "not in the window": one is a
  // game that has not come round yet, the other is a scheduled run that arrived
  // too late and must skip rather than rush. The operator needs to tell them
  // apart on the cycles list.
  if (now.getTime() >= cutoffAt) return "past_cutoff";

  if (
    lastCycleStartedAt !== null &&
    now.getTime() - lastCycleStartedAt.getTime() <
      PAPER_CYCLE_INTERVAL_MINUTES * 60_000
  ) {
    return "coalesced";
  }

  return "evaluate";
}

/**
 * The stable identity of a game window: the game's own stored kickoff.
 *
 * Per game rather than per calendar day, which is what makes Thursday night, a
 * 9:30am London game, a Saturday doubleheader, and Monday night one code path
 * — the same reason staleness is measured from each game's own kickoff.
 */
export function gameWindowKey(kickoffAt: Date): string {
  return kickoffAt.toISOString();
}

/**
 * The account-local calendar date, for the duplicate-exposure key.
 *
 * NFL schedules are expressed in Eastern time, and a Sunday-night game that
 * kicks off after midnight UTC is still Sunday's slate to a person looking at
 * it. Using UTC here would split one evening's decisions across two keys.
 */
export function accountLocalDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
