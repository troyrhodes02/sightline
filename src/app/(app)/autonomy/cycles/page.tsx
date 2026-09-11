import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/autonomy/cycles` is retired — Cycles are absorbed into Paper Bot → Activity
 * (PME-6, D10). A 308 permanent redirect preserves existing bookmarks; the
 * cycle diagnostics live at `/autonomy/activity?view=cycles`.
 *
 * `permanentRedirect` throws, so this component never renders — and the target
 * carries the admin guard, so this redirect must NOT itself be guarded (that
 * would 403 a viewer instead of forwarding the link).
 */
export default function CyclesRedirect() {
  permanentRedirect("/autonomy/activity?view=cycles");
}
