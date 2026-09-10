import { serverEnv } from "@/env";
import { requireSession } from "@/lib/auth/session";
import { readSlateGrouped } from "@/lib/slate/read-grouped";
import { Slate } from "@/components/screens/Slate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Slate · Sightline" };

/**
 * The slate. A database read — never a model run, and never blocked on the
 * refresh round-trip: rows render from stored observations and the poller
 * island keeps prices current in place.
 *
 * The role is resolved server-side and decides which serializer builds the
 * payload; a viewer's slate is constructed by code that never queries
 * decisions.
 */
export default async function SlatePage() {
  const session = await requireSession();
  const slate = await readSlateGrouped(session.user.role);
  const env = serverEnv();
  return (
    <Slate
      slate={slate}
      refreshIntervalSeconds={env.SLATE_REFRESH_INTERVAL_SECONDS}
      refreshFreshnessSeconds={env.PRICE_ONVIEW_FRESHNESS_SECONDS}
      isAdmin={session.user.role === "admin"}
    />
  );
}
