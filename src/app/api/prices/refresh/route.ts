import { requireSession } from "@/lib/auth/session";
import { latestCoalescedResult, runMarketSync } from "@/lib/kalshi/sync";
import {
  PRICE_REFRESH_LOCK_KEY,
  withPriceRefreshLock,
} from "@/lib/kalshi/refresh-lock";
import { jsonError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

/**
 * The price-refresh surface — the ONE sanctioned target of a client-side
 * fetch in this product. The browser talks only to Sightline; whether Kalshi
 * is actually contacted is decided server-side, where the rate-limit budget
 * lives (coalescing per RD-13).
 *
 * Shared, not admin-only: the slate is a shared surface and both roles keep
 * it current — the automatic on-view refresh (Pitch 10) runs on any session.
 * A Kalshi outage is a **designed degraded mode, not an error** — the response
 * stays 200 with `degraded: true` and the slate renders projections with
 * last-observed prices.
 *
 * A Postgres advisory lock (Pitch 10) serializes refreshes across serverless
 * instances: concurrent viewers produce exactly one upstream Kalshi call, and a
 * caller that finds the lock held reads whatever the in-flight refresh lands.
 */
export async function POST(): Promise<Response> {
  await requireSession();

  try {
    const result = await withPriceRefreshLock(
      PRICE_REFRESH_LOCK_KEY,
      runMarketSync,
      latestCoalescedResult,
    );
    return Response.json(result, { status: 200 });
  } catch {
    // A Kalshi problem — or an unusually slow sync that trips the lock
    // transaction — is a designed degraded mode, not an error. Fall back to the
    // last stored prices as a degraded 200 so the slate keeps rendering; only a
    // total inability to read even the last run reaches the client as an error.
    try {
      const last = await latestCoalescedResult();
      return Response.json({ ...last, degraded: true }, { status: 200 });
    } catch {
      return jsonError("internal_error", "The price refresh failed.");
    }
  }
}
