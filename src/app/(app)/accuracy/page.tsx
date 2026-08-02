import { requireSession } from "@/lib/auth/session";
import { parseAccuracyScope, type SearchParams } from "@/lib/accuracy/scope";
import { readAccuracy } from "@/lib/accuracy/read";
import { Accuracy } from "@/components/screens/Accuracy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accuracy · Sightline" };

/**
 * The accuracy surface — a shared read for any authenticated user, year-round,
 * from stored results only: no backtest, recompute, settlement refresh, or
 * grading ever runs in this request path.
 *
 * Scope travels in the URL so every view is shareable; unrecognized values
 * fall back to defaults silently. The role is resolved server-side and decides
 * the serializer: a viewer's payload is built by code that never queries
 * decisions, so the private layer is structurally absent, not hidden.
 */
export default async function AccuracyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const scope = parseAccuracyScope(await searchParams);
  const accuracy = await readAccuracy(scope, session.user.role);
  return <Accuracy accuracy={accuracy} />;
}
