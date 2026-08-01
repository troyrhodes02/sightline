/**
 * The scheduled price path's server-side cadence decision (RD-Q5).
 *
 * The cron fires every 15 minutes year-round; THIS module decides what an
 * invocation actually does, from the stored schedule — never from hardcoded
 * season dates. Pure so the decision table is exhaustively testable.
 */

import {
  GAMEDAY_PRICE_WINDOW_HOURS,
  PRICE_IN_WEEK_CADENCE_MINUTES,
  SEASON_LOOKAHEAD_DAYS,
} from "@/lib/health/config";
import { hasUpcomingKickoff, isGamedayPriceWindow } from "@/lib/health/derive";

export type PriceRefreshAction =
  /** No scheduled game inside the lookahead — offseason; Kalshi is not called. */
  | "not_expected"
  /** In-week and the last sync is younger than the in-week cadence. */
  | "coalesced"
  /** Run the sync: game-day window, or the in-week cadence has elapsed. */
  | "sync";

export function decidePriceRefreshAction(inputs: {
  /** Kickoffs of scheduled, not-yet-started games. */
  kickoffs: ReadonlyArray<Date>;
  /** Completion time of the last completed market sync, any status. */
  lastSyncFinishedAt: Date | null;
  now: Date;
}): PriceRefreshAction {
  const { kickoffs, lastSyncFinishedAt, now } = inputs;

  const lookaheadMs = SEASON_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  if (!hasUpcomingKickoff(kickoffs, now, lookaheadMs)) return "not_expected";

  const gamedayWindowMs = GAMEDAY_PRICE_WINDOW_HOURS * 60 * 60 * 1000;
  if (isGamedayPriceWindow(kickoffs, now, gamedayWindowMs)) return "sync";

  const inWeekCadenceMs = PRICE_IN_WEEK_CADENCE_MINUTES * 60 * 1000;
  if (
    lastSyncFinishedAt &&
    now.getTime() - lastSyncFinishedAt.getTime() < inWeekCadenceMs
  ) {
    return "coalesced";
  }
  return "sync";
}
