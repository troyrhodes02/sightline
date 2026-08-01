import { requireSession } from "@/lib/auth/session";
import { runMarketSync } from "@/lib/kalshi/sync";
import { jsonError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

/**
 * The price-refresh surface — the ONE sanctioned target of a client-side
 * fetch in this product. The browser talks only to Sightline; whether Kalshi
 * is actually contacted is decided server-side, where the rate-limit budget
 * lives (coalescing per RD-13).
 *
 * Shared, not admin-only: the slate is a shared surface and both roles keep
 * it current. A Kalshi outage is a **designed degraded mode, not an error** —
 * the response stays 200 with `degraded: true` and the slate renders
 * projections with last-observed prices.
 */
export async function POST(): Promise<Response> {
  await requireSession();

  try {
    const result = await runMarketSync();
    return Response.json(result, { status: 200 });
  } catch {
    // Unexpected only — Kalshi failures are handled inside the sync and
    // recorded on the run. Nothing internal reaches the client.
    return jsonError("internal_error", "The price refresh failed.");
  }
}
