import { requireAdmin } from "@/lib/auth/session";
import { readPaperBotPerformance } from "@/lib/paper/performance";
import { PaperBotPerformance } from "@/components/screens/PaperBotPerformance";
import type { ScorecardPeriod } from "@/lib/dto/model-eval";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper Bot · Sightline" };

/**
 * Paper Bot → Performance (PME-6, D10). The section's landing: three portfolio
 * scorecards, per-portfolio breach state, a 3-series bankroll chart, and the
 * readiness summary with its detail one click away. Admin-only: `requireAdmin()`
 * runs before any read, so a viewer is rejected server-side with no shell first.
 */
export default async function PaperBotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const data = await readPaperBotPerformance(period);

  return <PaperBotPerformance data={data} />;
}

function parsePeriod(value: string | string[] | undefined): ScorecardPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "current_week" || raw === "previous_week" || raw === "two_week"
    ? raw
    : "campaign";
}
