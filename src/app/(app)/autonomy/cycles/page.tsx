import { requireAdmin } from "@/lib/auth/session";
import { readCycles } from "@/lib/paper/read";
import { AutonomyCycles } from "@/components/screens/AutonomyCycles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autonomy cycles · Sightline" };

export default async function AutonomyCyclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  // The URL is user-editable input, not a form: an unparseable value falls
  // back to the default rather than erroring, matching the accuracy surface.
  const season = numeric(params.season);
  const week = numeric(params.week);
  const scope = await readCycles({ season, week });

  return <AutonomyCycles {...scope} />;
}

function numeric(value: string | string[] | undefined): number | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || !/^\d+$/.test(first)) return undefined;
  return Number(first);
}
