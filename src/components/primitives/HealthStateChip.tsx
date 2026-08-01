import { StatusChip, type StatusTone } from "./StatusChip";
import type { HealthSignalState } from "@/lib/health/types";

const PRESENTATION: Record<
  Exclude<HealthSignalState, "ok">,
  { label: string; tone: StatusTone; filled: boolean; icon: boolean }
> = {
  running: {
    label: "Running",
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
 * Six states, and only two of them amber.
 *
 * `running`, `never run`, and `not expected` are neutral facts — an attempt in
 * flight, a fresh environment, a correct offseason — not alarms. `late` and
 * `failed` are the two that want attention. They stay distinct because the
 * health surface exists precisely so different facts are not collapsed into
 * one shrug.
 *
 * **`ok` renders nothing.** A healthy job carries no badge, so the only chips
 * on the surface are the ones that want attention.
 */
export function HealthStateChip({ state }: { state: HealthSignalState }) {
  if (state === "ok") return null;

  const { label, tone, filled, icon } = PRESENTATION[state];
  return <StatusChip label={label} tone={tone} filled={filled} icon={icon} />;
}
