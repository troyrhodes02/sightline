import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";
import type { EvidenceStrength } from "@/lib/dto/model-eval";

/**
 * The evidence-strength indicator — three steps (filled / half / outlined),
 * always with its count (design doc). Strength scales with the record's own
 * sample floor upstream, so this component only renders the resolved band and
 * never re-decides it. `limited` is warning-toned; strong/moderate wear the
 * neutral model-adjacent tone so a thin sample looks thin rather than confident.
 *
 * The count is mandatory: a strength word without its n would be exactly the
 * unqualified rate the surface exists to avoid. When a sample is below its
 * floor the label says so in words (`n<floor`) rather than colour alone.
 */

const STEPS: Record<EvidenceStrength, number> = {
  strong: 3,
  moderate: 2,
  limited: 1,
};

const WORD: Record<EvidenceStrength, string> = {
  strong: "strong",
  moderate: "moderate",
  limited: "limited",
};

export function EvidenceChip({
  strength,
  sampleSize,
  belowFloor = false,
  floor,
}: {
  strength: EvidenceStrength;
  sampleSize: number;
  /** Whether the sample is under the record's reporting floor. */
  belowFloor?: boolean;
  /** The applicable floor, shown as `n<floor` when below it. */
  floor?: number;
}) {
  const filled = STEPS[strength];
  const color = strength === "limited" ? "warning.main" : "text.secondary";
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: "center" }}
      aria-label={`Evidence ${WORD[strength]}, ${sampleSize} observations`}
    >
      <Stack direction="row" spacing={0.25} aria-hidden>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              width: 10,
              height: 6,
              borderRadius: 0.5,
              border: "1px solid",
              borderColor: color,
              bgcolor: i < filled ? color : "transparent",
            }}
          />
        ))}
      </Stack>
      <Typography variant="caption" component="span" sx={{ color }}>
        {WORD[strength]}
      </Typography>
      <NumericText size="sm" muted component="span">
        {belowFloor && floor !== undefined
          ? `n<${floor}`
          : `${sampleSize.toLocaleString("en-US")} obs`}
      </NumericText>
    </Stack>
  );
}
