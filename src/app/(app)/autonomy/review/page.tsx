import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/autonomy/review` is retired — Review is absorbed into Paper Bot →
 * Performance (PME-6, D10). Review is no longer a primary destination, but its
 * underlying `PaperReplay` records are retained. A 308 permanent redirect
 * preserves existing bookmarks.
 *
 * `permanentRedirect` throws, so this component never renders; the admin guard
 * lives on the target.
 */
export default function ReviewRedirect() {
  permanentRedirect("/autonomy");
}
