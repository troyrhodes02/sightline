// A client component because the row passes `component={Link}` to MUI (a
// function prop that cannot cross the RSC serialization boundary — same
// reasoning as EmptyState).
"use client";

import Link from "next/link";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";

/**
 * The admin's doorway to the overrides surface. Rendered ONLY when the server
 * payload carries the admin section — for viewers this component is never
 * mounted, never disabled, never placeholdered: the private layer is absent,
 * not hidden.
 */
export function OverridesEntry({ decisionCount }: { decisionCount: number }) {
  return (
    <Paper>
      <ButtonBase
        component={Link}
        href="/accuracy/overrides"
        sx={{
          width: "100%",
          justifyContent: "space-between",
          textAlign: "left",
          px: 2,
          py: 1.5,
          gap: 2,
        }}
      >
        <Stack spacing={0.25}>
          <Typography variant="label">Overrides</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            took, faded, skipped, and timing cost — private
          </Typography>
        </Stack>
        <NumericText size="sm" muted>
          {decisionCount.toLocaleString("en-US")}{" "}
          {decisionCount === 1 ? "decision" : "decisions"} →
        </NumericText>
      </ButtonBase>
    </Paper>
  );
}
