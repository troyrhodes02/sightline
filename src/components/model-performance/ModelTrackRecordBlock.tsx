import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";
import { ConfidenceValue, ProbabilityValue } from "@/components/slate/values";
import { EvidenceChip } from "./EvidenceChip";
import type { ContractTrackRecordDto } from "@/lib/dto/model-eval";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * The viewer-facing model track-record block on contract detail (Screen 4,
 * D8/D18/D22). The one and only model-quality surface a viewer sees, and it
 * renders identically for the admin.
 *
 * It shows three things, all a function of the ACTIVE production model's own
 * graded record: the model's probability and confidence for this contract; a
 * sample-size-aware interpretation of that probability's bucket; and a stat-type
 * track-record label. It shows nothing else — no leader, no shadow, no bankroll,
 * no admin link — so a viewer cannot infer a second engine exists (D22).
 *
 * Three display states:
 * - `dto === null` → the honest "building" state with the count so far.
 * - `dto.belowFloor` → the running-count sentence, never a fabricated rate (D8).
 * - otherwise → the observed frequency with its sample size.
 *
 * Probability is a % (`ProbabilityValue`); confidence is a word
 * (`ConfidenceValue`); the two carry distinct labels and are never conflated
 * (D16).
 */

const STAT_TITLE: Record<StatType, string> = {
  passing_yards: "Passing yards",
  rushing_yards: "Rushing yards",
  receiving_yards: "Receiving yards",
  receptions: "Receptions",
  rushing_tds: "Rushing touchdowns",
  receiving_tds: "Receiving touchdowns",
};

export function ModelTrackRecordBlock({
  dto,
  statType,
  buildingCount = 0,
}: {
  /** The track record, or null when no active-model graded evidence exists. */
  dto: ContractTrackRecordDto | null;
  /** The contract's stat type, used for the building-state label. */
  statType: StatType;
  /** Graded observations so far for the stat — shown in the building state. */
  buildingCount?: number;
}) {
  // Building: no graded evidence for this stat yet. Never absent-without-
  // explanation, never a fabricated rate — the count so far, plainly stated.
  if (dto === null) {
    return (
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Model track record:
          </Typography>
          <Typography variant="body2" sx={{ color: "warning.main" }}>
            building
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Not enough graded predictions for {STAT_TITLE[statType].toLowerCase()}{" "}
          yet to report a track record ({buildingCount.toLocaleString("en-US")}{" "}
          so far).
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      {/* Probability and confidence: a % and a word, each with its own label,
          never conflated (D16). */}
      <Stack
        direction="row"
        spacing={2.5}
        sx={{ alignItems: "baseline", flexWrap: "wrap", rowGap: 1 }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Sightline probability
          </Typography>
          <ProbabilityValue value={dto.modelProbability} size="md" />
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "baseline" }}>
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            confidence
          </Typography>
          <ConfidenceValue confidence={dto.confidence} size="sm" />
        </Stack>
      </Stack>

      {/* Range interpretation — the observed frequency in the displayed
          probability's bucket, or the honest insufficient-evidence sentence
          below the floor, always with the running count (D8). */}
      {dto.belowFloor || dto.rangeObservedRate === null ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Not enough graded predictions in the {dto.rangeLabel} range yet to
          report how often they&apos;ve occurred (
          <NumericText size="sm" muted component="span">
            {dto.rangeSampleSize.toLocaleString("en-US")}
          </NumericText>{" "}
          so far).
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Predictions in the {dto.rangeLabel} range have occurred{" "}
          <NumericText
            size="sm"
            component="span"
            sx={{ color: "text.primary" }}
          >
            {Math.round(dto.rangeObservedRate * 100)}%
          </NumericText>{" "}
          of the time across{" "}
          <NumericText size="sm" muted component="span">
            {dto.rangeSampleSize.toLocaleString("en-US")}
          </NumericText>{" "}
          graded observations.
        </Typography>
      )}

      {/* Stat-type track-record label. `limited` never implies profitability. */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {STAT_TITLE[statType]} track record:
        </Typography>
        <EvidenceChip
          strength={dto.trackRecord}
          sampleSize={dto.statObservations}
        />
      </Stack>
    </Stack>
  );
}
