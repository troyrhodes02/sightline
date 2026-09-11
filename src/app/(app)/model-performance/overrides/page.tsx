import { requireAdmin } from "@/lib/auth/session";
import {
  decisionSeasons,
  parseOverridesScope,
  readOverridePerformance,
  type OverridesSearchParams,
} from "@/lib/accuracy/overrides";
import { Overrides } from "@/components/screens/Overrides";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overrides · Sightline" };

/**
 * The overrides surface — admin only, enforced server-side before any shell
 * of this page exists: a viewer deep link renders the 403 in place. The read
 * behind it derives everything from stored decision snapshots, final
 * pre-kickoff snapshots, and settlements; nothing recomputes from current
 * prices or projections in this request path.
 */
export default async function OverridesPage({
  searchParams,
}: {
  searchParams: Promise<OverridesSearchParams>;
}) {
  await requireAdmin();
  const seasons = await decisionSeasons();
  const scope = parseOverridesScope(await searchParams, seasons);
  const overrides = await readOverridePerformance(scope);
  return <Overrides overrides={overrides} availableSeasons={seasons} />;
}
