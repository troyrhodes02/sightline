import Chip from "@mui/material/Chip";

import type { PaperRiskModeName } from "@/lib/dto/model-eval";
import type { PaperPortfolio } from "../../../generated/prisma/enums";

/**
 * The Paper Bot Lab chips (design doc §9).
 *
 * A bot summary carries its engine and risk mode as plain enum names (not the
 * full `RiskModeDto` the cycle surfaces use), so these render from the name
 * alone. Both read every colour from the theme — no hardcoded hex — and stay
 * 4px-radius outlined chips, never pills.
 */

const ENGINE_LABEL: Record<PaperPortfolio, string> = {
  baseline: "Baseline",
  simulation: "Simulation",
  hybrid: "Hybrid",
};

/** The engine a bot prices from. Model-derived, so it wears the model accent. */
export function BotEngineChip({ engine }: { engine: PaperPortfolio }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={ENGINE_LABEL[engine] ?? engine}
      sx={{ color: "primary.main", borderColor: "primary.main" }}
    />
  );
}

/**
 * A bot's risk mode. Aggressive wears the caution tone — more permitted risk is
 * a caution, not an achievement — matching `RiskModeChip` on the cycle surfaces.
 */
export function BotRiskModeChip({ mode }: { mode: PaperRiskModeName }) {
  const tone =
    mode === "aggressive"
      ? "warning.main"
      : mode === "custom"
        ? "primary.main"
        : "text.secondary";
  return (
    <Chip
      size="small"
      variant="outlined"
      label={mode}
      sx={{
        color: tone,
        borderColor: tone === "text.secondary" ? "border.strong" : tone,
      }}
    />
  );
}
