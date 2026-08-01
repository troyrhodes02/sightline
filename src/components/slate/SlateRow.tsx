// Client components because rows pass `component={Link}` to MUI — a function
// prop, which cannot cross the server->client serialization boundary (same
// reasoning as EmptyState). Row data arrives as plain DTOs, so nothing else
// is lost by rendering these on the client.
"use client";

import Box from "@mui/material/Box";
import Link from "next/link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { SlateRowDto, UnresolvedRowDto } from "@/lib/dto/slate";
import {
  ConfidenceValue,
  DispositionChip,
  EdgeValue,
  formatEtTime,
  PriceValue,
  ProbabilityValue,
  RowTimestamps,
} from "./values";

const STAT_LABELS: Record<SlateRowDto["statType"], string> = {
  passing_yards: "pass yds",
  rushing_yards: "rush yds",
  receiving_yards: "rec yds",
  receptions: "receptions",
  rushing_tds: "rush TDs",
  receiving_tds: "rec TDs",
};

/**
 * One slate row. **Identical height for every variant** — recommended,
 * below-threshold, no-projection, disposition-marked — because a taller
 * highlighted row breaks the column scanning that is the entire point of the
 * list. Recommendation is a 3px accent bar plus the chip word; de-emphasis is
 * text colour, never removal or collapse.
 *
 * The whole row is a link: Tab reaches it, Enter opens detail. Arrow-key
 * movement between rows is added by the client-side key handler on the list.
 */
export function SlateRow({ row }: { row: SlateRowDto }) {
  const dimmed = !row.isRecommended;
  const textColor = dimmed ? "text.secondary" : "text.primary";

  return (
    <Box
      component={Link}
      href={`/slate/${row.contractId}`}
      data-slate-row
      sx={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        px: 2,
        py: 1.25,
        borderLeft: "3px solid",
        borderLeftColor: row.isRecommended ? "primary.main" : "transparent",
        borderBottom: "1px solid",
        borderBottomColor: "divider",
        "&:hover": { bgcolor: "action.hover" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: -2,
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: { xs: "wrap", md: "nowrap" },
        }}
      >
        <Typography
          variant="body1"
          sx={{
            color: textColor,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: { md: "1 1 40%" },
          }}
        >
          {row.playerName} · {STAT_LABELS[row.statType]} ≥ {row.threshold}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", flex: { md: "0 0 auto" } }}
        >
          {row.gameLabel ?? "—"} · {formatEtTime(row.kickoffAt)}
        </Typography>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "baseline", flex: { md: "0 0 auto" } }}
        >
          <ProbabilityValue value={row.modelProbability} />
          <PriceValue
            cents={row.side === "no" ? row.noAskCents : row.yesAskCents}
          />
          <EdgeValue points={row.edgePoints} />
          <ConfidenceValue confidence={row.confidence} />
        </Stack>
      </Stack>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", mt: 0.5, flexWrap: "wrap" }}
      >
        {row.isRecommended ? (
          <StatusChip label={`recommended · ${row.side ?? ""}`} tone="accent" />
        ) : null}
        {row.modelProbability === null ? (
          <StatusChip label="no projection" tone="caution" />
        ) : null}
        {row.currentDisposition ? (
          <DispositionChip disposition={row.currentDisposition} />
        ) : null}
        <RowTimestamps
          projectionComputedAt={row.projectionComputedAt}
          priceObservedAt={row.priceObservedAt}
        />
      </Stack>
    </Box>
  );
}

/**
 * An unresolved contract: retained, visible to both roles, never dressed up
 * as resolved. The verbatim Kalshi title is the evidence; diagnostics arrive
 * only in admin payloads and render only when present.
 */
export function UnresolvedRow({ row }: { row: UnresolvedRowDto }) {
  return (
    <Box
      component={Link}
      href={`/slate/${row.contractId}`}
      data-slate-row
      sx={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        px: 2,
        py: 1.25,
        borderLeft: "3px solid transparent",
        borderBottom: "1px solid",
        borderBottomColor: "divider",
        "&:hover": { bgcolor: "action.hover" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: -2,
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Typography
          variant="body1"
          sx={{
            color: "text.secondary",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          “{row.title}”
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: "baseline" }}>
          <PriceValue cents={row.yesAskCents} />
          <StatusChip label="unresolved" tone="caution" icon />
        </Stack>
      </Stack>
      <Typography variant="numericSm" sx={{ color: "text.muted", mt: 0.5 }}>
        {row.kalshiTicker}
      </Typography>
    </Box>
  );
}
