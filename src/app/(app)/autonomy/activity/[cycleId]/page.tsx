import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { readCycleDetail } from "@/lib/paper/read";
import { AutonomyCycleDetail } from "@/components/screens/AutonomyCycles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cycle · Sightline" };

/**
 * Cycle detail, now under Paper Bot → Activity (PME-6, D10). The candidate-by-
 * candidate audit is retained verbatim; only its route moved. Admin-only.
 */
export default async function ActivityCycleDetailPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  await requireAdmin();
  const { cycleId } = await params;
  const detail = await readCycleDetail(cycleId);
  if (!detail) notFound();

  return <AutonomyCycleDetail detail={detail} />;
}
