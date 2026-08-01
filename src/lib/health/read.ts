import "server-only";

import type { HealthSignalState } from "./types";
import type { HealthSignalDto } from "@/lib/dto/health";

/**
 * The scheduled processes the health surface reports on.
 *
 * **This registry is deliberately static, and deliberately NOT wired to the
 * `ingest_runs` table.**
 *
 * Rows exist there from Pitch 1's manual local backfill. Rendering one as "last
 * successful ingest" would report a scheduled pipeline as healthy when no
 * scheduled pipeline exists — the precise false success this surface exists to
 * prevent, and the reason the pitch names it as a rabbit hole.
 *
 * Pitch 5 replaces this with real values, per signal, as each job ships. Until
 * then the honest answer is `not_yet_implemented`, and a job that does not
 * exist has no last-success time.
 */
const SIGNALS: ReadonlyArray<{
  key: HealthSignalDto["key"];
  label: string;
  state: HealthSignalState;
}> = [
  { key: "ingest", label: "Ingest", state: "not_yet_implemented" },
  { key: "recompute", label: "Recompute", state: "not_yet_implemented" },
  {
    key: "price_refresh",
    label: "Price refresh",
    state: "not_yet_implemented",
  },
];

/**
 * Reads the health signals.
 *
 * Async because Pitch 5's implementation queries; keeping the shape now means
 * the surface, its loading state, and its error state do not change then.
 */
export async function readHealthSignals(): Promise<HealthSignalDto[]> {
  return SIGNALS.map((signal) => ({
    key: signal.key,
    label: signal.label,
    state: signal.state,
    // No fabricated timestamp, no zero date, no `now()`. A job that does not
    // exist has never succeeded.
    lastSuccessAt: null,
    lastSuccessAge: null,
    expectedWithin: null,
    lastAttemptAt: null,
  }));
}
