import { requireAdmin } from "@/lib/auth/session";
import { readAutonomyOverview } from "@/lib/paper/read";
import { AutonomyOverview } from "@/components/screens/AutonomyOverview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autonomy · Sightline" };

/**
 * Admin-only. `requireAdmin()` runs before any read, so a viewer is rejected
 * server-side with no autonomy chrome rendered first — absence must be
 * indistinguishable from non-existence.
 */
export default async function AutonomyPage() {
  await requireAdmin();
  const overview = await readAutonomyOverview();

  return <AutonomyOverview overview={overview} />;
}
