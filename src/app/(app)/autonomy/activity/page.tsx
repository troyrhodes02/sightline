import { requireAdmin } from "@/lib/auth/session";
import { readActivity } from "@/lib/paper/activity";
import { PaperBotActivity } from "@/components/screens/PaperBotActivity";
import type { PaperPortfolio } from "../../../../../generated/prisma/enums";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper Bot activity · Sightline" };

/**
 * Paper Bot → Activity (PME-6, D10). Positions + cycle diagnostics across the
 * campaign's portfolios, deep-linked filters. Admin-only: `requireAdmin()` runs
 * before any read, so a viewer is rejected server-side with no shell first.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const view = first(params.view) === "cycles" ? "cycles" : "positions";
  const portfolioRaw = first(params.portfolio);
  const portfolio: PaperPortfolio | "all" =
    portfolioRaw === "baseline" ||
    portfolioRaw === "simulation" ||
    portfolioRaw === "hybrid"
      ? portfolioRaw
      : "all";
  const statusRaw = first(params.status);
  const status: "open" | "settled" | "all" =
    statusRaw === "settled" || statusRaw === "all" ? statusRaw : "open";

  const activity = await readActivity({ view, portfolio, status });

  return <PaperBotActivity activity={activity} />;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
