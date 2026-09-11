import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/autonomy/readiness` is retired — readiness is now a summary on Paper Bot →
 * Performance with its criterion detail one click away (PME-6, D10/D21). A 308
 * permanent redirect preserves existing bookmarks.
 *
 * `permanentRedirect` throws, so this component never renders; the admin guard
 * lives on the target.
 */
export default function ReadinessRedirect() {
  permanentRedirect("/autonomy");
}
