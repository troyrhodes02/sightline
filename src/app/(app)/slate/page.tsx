import { serverEnv } from "@/env";
import { requireSession } from "@/lib/auth/session";
import { readSlate } from "@/lib/slate/read";
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
  const slate = await readSlate(session.user.role);
  return (
    <Slate
      slate={slate}
      refreshIntervalSeconds={serverEnv().SLATE_REFRESH_INTERVAL_SECONDS}
    />
  );
}
