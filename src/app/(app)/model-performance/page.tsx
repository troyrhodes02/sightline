import { requireAdmin } from "@/lib/auth/session";
import { parseAccuracyScope, type SearchParams } from "@/lib/accuracy/scope";
import { readAccuracy } from "@/lib/accuracy/read";
import { readModelPerformance, parseLevel } from "@/lib/model-performance/read";
import { ModelPerformance } from "@/components/screens/ModelPerformance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model Performance · Sightline" };

/**
 * The Model Performance surface (PME-4, D9) — the admin's model-quality
 * experience, three levels under one heading (`?level=summary|breakdown|
 * advanced`, default summary). Admin only: `requireAdmin()` runs before any
 * read, so a viewer is rejected server-side with no shell rendered first.
 *
 * Everything is a stored-data read plus the paper ledger — no backtest,
 * recompute, grading, or paper cycle runs in this request path, and no read
 * here can write production config (D12). The Advanced level reuses the
 * preserved Accuracy read; Summary and Breakdown read the model-comparison
 * evidence + paper scorecards.
 */
export default async function ModelPerformancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const level = parseLevel(params.level);
  const scope = parseAccuracyScope(params);

  const [modelPerformance, accuracy] = await Promise.all([
    readModelPerformance(),
    readAccuracy(scope, "admin"),
  ]);

  return (
    <ModelPerformance
      level={level}
      modelPerformance={modelPerformance}
      accuracy={accuracy}
    />
  );
}
