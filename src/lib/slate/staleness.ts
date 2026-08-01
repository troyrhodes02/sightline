import type { StalenessDto } from "@/lib/dto/slate";

/**
 * The two staleness states, computed on read and never persisted — there is
 * no `isStale` column and no background job, by spec (RD-22/RD-23) and by
 * CLAUDE.md's derived-state posture.
 *
 * `stale` is *clearable*: an RD-22 fact group for this game carries a
 * `knownAt` later than the displayed projection's `informationCutoff`, so a
 * recompute whose cutoff passes those facts clears it. Ingest alone never
 * clears it — the displayed projection must actually reflect the information.
 *
 * `predates inactives` is *not clearable this version*: past
 * `kickoffAt − INACTIVES_LEAD_MINUTES` the game's contracts disclose that
 * their projections were computed before official inactives, because
 * Sightline has no inactives source yet. It is a disclosure, not a failure.
 * Adjustment Suggestions later converts it into a clearable state.
 *
 * Both derive from the *currently stored* kickoff at evaluation time
 * (RD-Q12), so a flexed or postponed game follows its updated kickoff at the
 * next read with no cached job plan to invalidate. "Permanent" (RD-23) means
 * no recompute clears predates-inactives — not that it survives a kickoff
 * moving later.
 *
 * Pure module: no prisma, no env — callers supply the configured lead, the
 * same way `computeEdge` takes its threshold. DB batching lives in
 * `staleness-read.ts`.
 */

export type StalenessInputs = {
  /** The game's currently stored kickoff. */
  kickoffAt: Date;
  /** The displayed projection's information cutoff; null when no projection. */
  informationCutoff: Date | null;
  /** Max `knownAt` across the game's RD-22 fact groups; null when none exist. */
  latestFactKnownAt: Date | null;
  now: Date;
};

/** Kickoff − configured lead: the instant official inactives are expected. */
export function inactivesExpectedAt(
  kickoffAt: Date,
  leadMinutes: number,
): Date {
  return new Date(kickoffAt.getTime() - leadMinutes * 60_000);
}

/**
 * Staleness for one displayed projection. Returns null when there is no
 * projection — staleness qualifies a projection, and `null` is a different
 * state from "not stale", exactly as `modelProbability: null` is not zero.
 */
export function evaluateStaleness(
  inputs: StalenessInputs,
  leadMinutes: number,
): StalenessDto | null {
  if (inputs.informationCutoff === null) return null;

  const isStale =
    inputs.latestFactKnownAt !== null &&
    inputs.latestFactKnownAt.getTime() > inputs.informationCutoff.getTime();

  const boundary = inactivesExpectedAt(inputs.kickoffAt, leadMinutes);
  const predatesInactives = inputs.now.getTime() >= boundary.getTime();

  return {
    isStale,
    predatesInactives,
    inactivesExpectedAt: predatesInactives ? boundary.toISOString() : null,
  };
}

/**
 * Compact age for a timestamps line: "0m", "38m", "6h", "2d 4h". Never vague
 * words, never negative — a timestamp from the future (clock skew) reads "0m".
 */
export function formatAge(fromIso: string, now: Date): string {
  const ms = now.getTime() - new Date(fromIso).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainderHours = hours - days * 24;
  return remainderHours > 0 ? `${days}d ${remainderHours}h` : `${days}d`;
}
