import { requireSession } from "@/lib/auth/session";
import { latestCoalescedResult, runMarketSync } from "@/lib/kalshi/sync";
import { jsonError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

/**
 * The price-refresh surface — the ONE sanctioned target of a client-side
 * fetch in this product. The browser talks only to Sightline; whether Kalshi
 * is actually contacted is decided server-side, where the rate-limit budget
 * lives.
 *
 * Shared, not admin-only: the slate is a shared surface and both roles keep
 * it current — the automatic on-view refresh (Pitch 10) runs on any session.
 * A Kalshi outage is a **designed degraded mode, not an error** — the response
 * stays 200 with `degraded: true` and the slate renders projections with
 * last-observed prices.
 *
 * Concurrency is handled by `runMarketSync` itself: an in-process in-flight gate
 * collapses concurrent callers within an instance, and a database min-interval
 * coalesce (against the last `MarketSyncRun`) means a caller that arrives just
 * after a recent sync returns the stored result without a second upstream call.
 *
 * NOTE (stability): an earlier revision wrapped this sync in a Postgres advisory
 * lock held inside a long interactive `$transaction`. On the transaction-mode
 * pooler that pins a connection for the whole multi-second Kalshi sync and can
 * exhaust the small serverless pool — which manifested as app-wide 503s
 * (sign-in included) during the on-view refresh. The lock is removed: the
 * coalescing above is sufficient at Sightline's scale, and never holds a
 * connection across the external call.
 */
export async function POST(): Promise<Response> {
  await requireSession();

  try {
    const result = await runMarketSync();
    return Response.json(result, { status: 200 });
  } catch {
    // A Kalshi problem is a designed degraded mode, not an error. Fall back to
    // the last stored prices as a degraded 200 so the slate keeps rendering;
    // only a total inability to read even the last run reaches the client as an
    // error.
    try {
      const last = await latestCoalescedResult();
      return Response.json({ ...last, degraded: true }, { status: 200 });
    } catch {
      return jsonError("internal_error", "The price refresh failed.");
    }
  }
}
