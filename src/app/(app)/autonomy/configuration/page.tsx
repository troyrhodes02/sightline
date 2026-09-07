import { requireAdmin } from "@/lib/auth/session";
import { readConfiguration } from "@/lib/paper/read";
import { AutonomyConfiguration } from "@/components/screens/AutonomyConfiguration";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autonomy configuration · Sightline" };

export default async function AutonomyConfigurationPage() {
  await requireAdmin();
  const config = await readConfiguration();

  return <AutonomyConfiguration config={config} />;
}
