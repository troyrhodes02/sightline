import { permanentRedirect } from "next/navigation";
import type { SearchParams } from "@/lib/accuracy/scope";

export const dynamic = "force-dynamic";

/**
 * `/accuracy` is retired — the surface is now Model Performance (PME-4, D9). A
 * 308 permanent redirect preserves every existing deep link.
 *
 * A legacy link that carried a statistical scope (a record, version, stat,
 * population, or season query — the Advanced surface's own vocabulary) lands on
 * the Advanced level, where those panels live; a bare `/accuracy` link lands on
 * the default Summary level. Any scope params are forwarded so a shared
 * Advanced link resolves to exactly the same view.
 *
 * `permanentRedirect` throws, so this component never renders.
 */
const STATISTICAL_KEYS = ["record", "version", "population", "stat", "season"];

export default async function AccuracyRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
  }

  const isStatisticalDeepLink = STATISTICAL_KEYS.some((key) => search.has(key));
  if (isStatisticalDeepLink) search.set("level", "advanced");

  const query = search.toString();
  permanentRedirect(`/model-performance${query ? `?${query}` : ""}`);
}
