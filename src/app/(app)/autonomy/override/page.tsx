import { requireAdmin } from "@/lib/auth/session";
import { readActiveBreaches } from "@/lib/paper/read";
import { AutonomyOverride } from "@/components/screens/AutonomyOverride";

export const dynamic = "force-dynamic";
export const metadata = { title: "Force override · Sightline" };

/**
 * Reached only from the overview's state banner, and only while a halting
 * condition is active. Direct navigation with nothing breached renders "no
 * active breach to override" rather than a usable form.
 */
export default async function AutonomyOverridePage() {
  await requireAdmin();
  const data = await readActiveBreaches();

  return <AutonomyOverride data={data} />;
}
