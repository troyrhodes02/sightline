import { requireAdmin } from "@/lib/auth/session";
import { readReadiness } from "@/lib/paper/readiness";
import { AutonomyReadiness } from "@/components/screens/AutonomyReadiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live readiness · Sightline" };

/**
 * Readiness is re-evaluated on every request. It reports and cannot act: the
 * module it reads from exports no mutation, and no route handler imports it.
 */
export default async function AutonomyReadinessPage() {
  await requireAdmin();
  const readiness = await readReadiness();

  return <AutonomyReadiness readiness={readiness} />;
}
