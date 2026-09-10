import { requireAdmin } from "@/lib/auth/session";
import { parseAccuracyScope, type SearchParams } from "@/lib/accuracy/scope";
import { readAccuracy } from "@/lib/accuracy/read";
import { Accuracy } from "@/components/screens/Accuracy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accuracy · Sightline" };

/**
 * The accuracy surface — admin only as of Pitch 10 (Slate Experience & Prop
 * Research): general model accuracy is the admin's evaluation machinery, not a
 * shared viewer read. A viewer deep link is rejected server-side, in place,
 * before any shell of this page exists. Everything is read from stored results:
 * no backtest, recompute, settlement refresh, or grading runs in this path.
 *
 * Scope travels in the URL so every view is shareable; unrecognized values
 * fall back to defaults silently. `readAccuracy` keeps its role-aware
 * serializer as defence in depth — the route guard is the boundary, but the
 * admin serializer is the only one this page ever asks for.
 */
export default async function AccuracyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const scope = parseAccuracyScope(await searchParams);
  const accuracy = await readAccuracy(scope, "admin");
  return <Accuracy accuracy={accuracy} />;
}
