import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/autonomy/positions` is retired — Positions are absorbed into Paper Bot →
 * Activity (PME-6, D10). A 308 permanent redirect preserves existing bookmarks.
 *
 * `permanentRedirect` throws, so this component never renders; the admin guard
 * lives on the target, not here.
 */
export default function PositionsRedirect() {
  permanentRedirect("/autonomy/activity?view=positions");
}
