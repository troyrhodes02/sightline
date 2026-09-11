import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/autonomy/cycles/[cycleId]` is retired — cycle detail moved under Paper Bot →
 * Activity (PME-6, D10). A 308 permanent redirect preserves existing deep links
 * to a specific cycle's audit.
 *
 * `permanentRedirect` throws, so this component never renders; the admin guard
 * lives on the target.
 */
export default async function CycleDetailRedirect({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  permanentRedirect(`/autonomy/activity/${cycleId}`);
}
