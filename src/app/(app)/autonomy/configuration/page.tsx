import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/autonomy/configuration` is retired — configuration moves to Paper Bot →
 * Settings alongside model selection (PME-6, D10/D13). A 308 permanent redirect
 * preserves existing bookmarks.
 *
 * `permanentRedirect` throws, so this component never renders; the admin guard
 * lives on the target.
 */
export default function ConfigurationRedirect() {
  permanentRedirect("/autonomy/settings");
}
