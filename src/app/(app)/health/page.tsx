import { requireAdmin } from "@/lib/auth/session";
import { readHealthSignals } from "@/lib/health/read";
import { Health } from "@/components/screens/Health";

export const dynamic = "force-dynamic";
export const metadata = { title: "System health · Sightline" };

export default async function HealthPage() {
  await requireAdmin();
  const signals = await readHealthSignals();

  return <Health signals={signals} />;
}
