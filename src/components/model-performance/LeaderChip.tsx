import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";
import type { LeaderState } from "@/lib/dto/model-eval";
import { modelDisplayName } from "@/lib/model-eval/config";

/**
 * The leader indicator — one closed four-state vocabulary (D14).
 *
 * A chip, never a button: the leader is decision support the admin reads, not a
 * control that activates anything (D12). Two of the four states name a leading
 * model in the model accent (outlined, never filled — the accent is reserved
 * for model-derived values and a filled chip would read as a market pill);
 * `too_close_to_call` is neutral; `not_enough_evidence` is warning-toned.
 *
 * Every state that is NOT `not_enough_evidence` carries its Brier margin and
 * both sample counts (D14) — the verdict is never shown without the evidence
 * behind it. The counts are the live and backtest observation counts for the
 * comparison; a comparison scoped to one record still shows both so the reader
 * sees which record is thin (D15 — the two are labelled, never blended).
 */

// Engine display names resolve through the shared `modelDisplayName` helper,
// keyed on the version constants, so a version bump never silently falls back to
// the generic label here.
const modelName = modelDisplayName;

function label(
  leader: LeaderState,
  simulationModelVersion: string,
  baselineModelVersion: string,
): string {
  switch (leader) {
    case "simulation_leads":
      return `${modelName(simulationModelVersion)} leads`;
    case "baseline_leads":
      return `${modelName(baselineModelVersion)} leads`;
    case "too_close_to_call":
      return "Too close to call";
    case "not_enough_evidence":
      return "Not enough evidence";
  }
}

type ChipTone = { color: string; borderColor: string };

function tone(leader: LeaderState): ChipTone {
  switch (leader) {
    case "simulation_leads":
    case "baseline_leads":
      // The model accent — outlined, reserved for model-derived verdicts (D19).
      return { color: "primary.main", borderColor: "primary.main" };
    case "too_close_to_call":
      return { color: "text.secondary", borderColor: "divider" };
    case "not_enough_evidence":
      return { color: "warning.main", borderColor: "warning.main" };
  }
}

export function LeaderChip({
  leader,
  brierMargin,
  liveObservations,
  backtestObservations,
  simulationModelVersion,
  baselineModelVersion,
  /** When false, the chip stands alone (evidence shown elsewhere, e.g. a table). */
  showEvidence = true,
  size = "small",
}: {
  leader: LeaderState;
  brierMargin: number | null;
  liveObservations: number;
  backtestObservations: number;
  simulationModelVersion: string;
  baselineModelVersion: string;
  showEvidence?: boolean;
  size?: "small" | "medium";
}) {
  const { color, borderColor } = tone(leader);
  const carriesEvidence = leader !== "not_enough_evidence";
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <Chip
        size={size}
        variant="outlined"
        label={label(leader, simulationModelVersion, baselineModelVersion)}
        sx={{ color, borderColor }}
      />
      {showEvidence && carriesEvidence ? (
        <Typography
          variant="caption"
          component="span"
          sx={{ color: "text.secondary" }}
        >
          {brierMargin === null ? (
            "margin —"
          ) : (
            <>
              margin{" "}
              <NumericText size="sm" component="span">
                {brierMargin.toFixed(3)}
              </NumericText>
            </>
          )}{" "}
          ·{" "}
          <NumericText size="sm" muted component="span">
            Live {liveObservations.toLocaleString("en-US")} obs · Backtest{" "}
            {backtestObservations.toLocaleString("en-US")} obs
          </NumericText>
        </Typography>
      ) : null}
    </Stack>
  );
}
