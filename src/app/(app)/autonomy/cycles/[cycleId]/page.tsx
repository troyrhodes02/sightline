import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { readCycleDetail } from "@/lib/paper/read";
import { AutonomyCycleDetail } from "@/components/screens/AutonomyCycles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cycle · Sightline" };

export default async function AutonomyCycleDetailPage({
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
