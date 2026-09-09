import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import {
  AutonomyHeading,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import { ReadinessChip } from "./AutonomyOverview";
import type {
  Readiness,
  ReadinessCategory,
  ReadinessCriterion,
} from "@/lib/paper/readiness";

/**
 * Live readiness.
 *
 * Evidence per criterion, grouped so financial evidence never blends into
 * model evidence — the pitch asks two separate questions (*did the bot make
 * simulated money* and *is there evidence the result came from a functioning
 * probabilistic system*) and a single merged list would answer neither.
 *
 * **There is no control on this page, in any state.** The chip is outlined,
 * never filled, and nothing sits next to it that could be mistaken for an
 * activation. The disclaimer renders in all three states and is *stronger* when
 * every criterion passes, because that is exactly when someone might read the
 * chip as permission.
 */
const CATEGORY_COPY: Record<ReadinessCategory, string> = {
  paper_evidence: "Paper evidence",
  model_quality: "Model quality",
  safety_operations: "Safety and operations",
};

export function AutonomyReadiness({ readiness }: { readiness: Readiness }) {
  const categories: ReadinessCategory[] = [
    "paper_evidence",
    "model_quality",
    "safety_operations",
  ];

  return (
    <Stack spacing={3}>
      <AutonomyHeading title="Live readiness" />
      <AutonomyTabs current="/autonomy/readiness" />

      <Paper sx={{ p: 2 }}>
        <ReadinessChip state={readiness.state} />
        <Typography variant="body2" sx={{ mt: 1.5, maxWidth: 660 }}>
          {readiness.disclaimer}
        </Typography>
      </Paper>

      {categories.map((category) => {
        const criteria = readiness.criteria.filter(
          (criterion) => criterion.category === category,
        );
        if (criteria.length === 0) return null;
        return (
          <Paper key={category} sx={{ px: 2, py: 1.5 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                mb: 0.5,
              }}
            >
              <Typography variant="h2">{CATEGORY_COPY[category]}</Typography>
              {category === "model_quality" ? (
                <Button
                  size="small"
                  variant="text"
                  component={Link}
                  href="/accuracy"
                >
                  Accuracy →
                </Button>
              ) : null}
            </Stack>
            {criteria.map((criterion) => (
              <CriterionRow key={criterion.key} criterion={criterion} />
            ))}
          </Paper>
        );
      })}

      <Typography variant="caption" sx={{ color: "text.muted" }}>
        Evaluated {formatTimestamp(readiness.evaluatedAt)} · re-evaluated on
        each page load
      </Typography>
    </Stack>
  );
}

/**
 * One criterion.
 *
 * The glyph carries pass/fail, not the colour — it has an accessible label so
 * the state survives greyscale and a screen reader. Every row states its
 * measured value AND its bound, so no criterion is a bare verdict.
 */
function CriterionRow({ criterion }: { criterion: ReadinessCriterion }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "18px 1fr",
        columnGap: 1.25,
        rowGap: 0.25,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
      }}
    >
      <Typography
        component="span"
        aria-label={criterion.met ? "met" : "not met"}
        role="img"
        sx={{
          color: criterion.met ? "primary.main" : "error.main",
          fontSize: 14,
          lineHeight: "20px",
        }}
      >
        {criterion.met ? "✓" : "✗"}
      </Typography>
      <Typography variant="body2">{criterion.label}</Typography>
      <Typography
        variant="caption"
        sx={{ gridColumn: 2, color: "text.secondary" }}
      >
        {criterion.evidence}
      </Typography>
    </Box>
  );
}
