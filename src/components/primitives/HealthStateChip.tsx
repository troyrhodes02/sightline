import { StatusChip, type StatusTone } from "./StatusChip";
import type { HealthSignalState } from "@/lib/health/types";

const PRESENTATION: Record<
  Exclude<HealthSignalState, "ok">,
  { label: string; tone: StatusTone; filled: boolean; icon: boolean }
> = {
  not_yet_implemented: {
    label: "Not yet implemented",
    tone: "neutral",
    filled: false,
    icon: false,
  },
  never_run: {
    label: "Never run",
    tone: "neutral",
    filled: false,
    icon: false,
  },
  not_expected: {
    label: "Not expected",
    tone: "neutral",
    filled: false,
    icon: false,
  },
  late: { label: "Late", tone: "caution", filled: true, icon: true },
  failed: { label: "Failed", tone: "caution", filled: true, icon: true },
};

/**
 * Six states, four of them kinds of "unavailable".
 *
 * They stay distinct because a not-built job, a job that has never run, a job
 * outside its window, and a job that failed are four different facts — and the
 * health surface exists precisely so they are not collapsed into one shrug.
 *
 * **`ok` renders nothing.** A healthy job carries no badge, so the only chips
 * on the surface are the ones that want attention.
 */
export function HealthStateChip({ state }: { state: HealthSignalState }) {
  if (state === "ok") return null;

  const { label, tone, filled, icon } = PRESENTATION[state];
  return <StatusChip label={label} tone={tone} filled={filled} icon={icon} />;
}
