import { permanentRedirect } from "next/navigation";
import type { SearchParams } from "@/lib/accuracy/scope";

export const dynamic = "force-dynamic";

/**
 * `/accuracy/overrides` is retired alongside `/accuracy` (PME-4, D9). A 308
 * permanent redirect preserves existing deep links to the override-performance
 * surface, now at `/model-performance/overrides`, forwarding any scope params.
 */
export default async function OverridesRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
  }
  const query = search.toString();
  permanentRedirect(`/model-performance/overrides${query ? `?${query}` : ""}`);
}
