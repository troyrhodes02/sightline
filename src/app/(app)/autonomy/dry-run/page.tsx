import { requireAdmin } from "@/lib/auth/session";
import { dryRunWindows } from "@/lib/paper/dry-run";
import { AutonomyDryRun } from "@/components/screens/AutonomyDryRun";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dry Run · Sightline" };

export default async function AutonomyDryRunPage() {
  await requireAdmin();
  const windows = await dryRunWindows(new Date());

  return <AutonomyDryRun windows={windows} />;
}
