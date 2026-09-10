import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Cross-instance single-flight for price refresh (Pitch 10, RD-2).
 *
 * The in-process gate and DB min-interval coalescing in `runMarketSync` collapse
 * concurrent callers WITHIN one serverless instance, but two viewers can land on
 * two instances at once. A transaction-scoped Postgres advisory lock closes that
 * gap: exactly one caller holds `pg_try_advisory_xact_lock` for the market set
 * and performs the upstream Kalshi call; a concurrent caller that cannot acquire
 * it immediately runs `onBusy` — which does NO upstream call and returns whatever
 * price the in-flight refresh lands. The lock auto-releases at transaction end,
 * so a crashed request can never leave it held (no manual TTL to leak).
 *
 * The DEFAULT market-set key. Sightline refreshes the active upcoming-market set
 * as one unit, so one key serializes the whole refresh; a future per-slate split
 * would pass a distinct key here.
 */
export const PRICE_REFRESH_LOCK_KEY = "price-refresh:v1";

/**
 * The transaction that holds the advisory lock stays open for the full duration
 * of `acquired` (the upstream Kalshi sync), because the lock is transaction-scoped
 * and must not release while the sync it serializes is still in flight. Prisma's
 * default interactive-transaction timeout is 5s — far shorter than a full slate
 * sync (thousands of markets across several Kalshi calls), which would abort with
 * P2028, surface as an error rather than the designed degraded mode, AND release
 * the lock mid-sync so a second caller could fire a duplicate upstream call. So
 * the timeout is raised to comfortably exceed a worst-case sync while staying well
 * under the serverless function limit. `maxWait` bounds how long a concurrent
 * caller waits for a pooled connection before it, too, proceeds (to `onBusy`).
 *
 * At Sightline's scale (a handful of users) holding one pooled connection for the
 * sync duration is acceptable; this is deliberately not engineered for high
 * concurrency (see CLAUDE.md — over-provisioning is the likelier failure here).
 */
const PRICE_REFRESH_LOCK_MAX_WAIT_MS = 5_000;
const PRICE_REFRESH_LOCK_TIMEOUT_MS = 120_000;

/**
 * Run `acquired` under the advisory lock for `marketSetKey`, or `onBusy` when the
 * lock is already held. `onBusy` MUST NOT contact Kalshi — that is the guarantee
 * that concurrent staleness-triggered refreshes produce exactly one upstream call.
 */
export async function withPriceRefreshLock<T>(
  marketSetKey: string,
  acquired: () => Promise<T>,
  onBusy: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${marketSetKey})) AS locked`;
      const locked = rows[0]?.locked === true;
      if (!locked) return onBusy();
      return acquired();
    },
    {
      maxWait: PRICE_REFRESH_LOCK_MAX_WAIT_MS,
      timeout: PRICE_REFRESH_LOCK_TIMEOUT_MS,
    },
  );
}
