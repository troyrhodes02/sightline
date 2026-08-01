import { requireAdmin } from "@/lib/auth/session";
import { readHealth } from "@/lib/health/read";
import { Health } from "@/components/screens/Health";

export const dynamic = "force-dynamic";
export const metadata = { title: "System health · Sightline" };

export default async function HealthPage() {
  await requireAdmin();
  const health = await readHealth();

  return <Health health={health} />;
}
