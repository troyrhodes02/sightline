"use client";

import Box from "@mui/material/Box";
import Link from "next/link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { SlateGroupedDto } from "@/lib/dto/slate";
import { probabilityGlyph, propTitle } from "./prop-display";
import {
  EdgeValue,
  formatEtTime,
  PriceValue,
  ProbabilityValue,
} from "./values";

/**
 * The cross-game strongest-opportunity slice (Screen 1) — the SAME rows the
 * game groups show, re-emphasised, ranked by the existing slate order (RD-5).
 * Each entry links to its prop's detail. A below-direction prop can lead; the
 * glyph and sign carry direction, never colour alone.
 *
 * "Best does not mean likeliest" (design doc §2.4): this ranks by edge, so a
 * lower probability can outrank a higher one — the numbers travel with their
 * provenance so that is legible.
 */
export function BestOpportunities({
  rows,
}: {
  rows: SlateGroupedDto["bestOpportunities"];
}) {
  if (rows.length === 0) {
    // A legitimate answer, deliberately quiet — never warning-styled. The game
    // groups below remain browsable.
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Nothing clears the recommendation threshold today.
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {rows.map((entry) => {
        const { prop } = entry;
        const recommended = prop.isRecommended;
        return (
          <Box
            key={`${entry.playerId}:${prop.direction}:${prop.threshold}`}
            component={prop.contractId ? Link : "div"}
            href={prop.contractId ? `/slate/${prop.contractId}` : undefined}
            data-best-opportunity
            sx={{
              display: "block",
              textDecoration: "none",
              color: "inherit",
              px: 2,
              py: 1.25,
              border: "1px solid",
              borderColor: "divider",
              borderLeft: "3px solid",
              borderLeftColor: recommended ? "primary.main" : "transparent",
              borderRadius: 1,
              "&:hover": prop.contractId ? { bgcolor: "action.hover" } : {},
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: -2,
              },
            }}
          >
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "baseline",
                justifyContent: "space-between",
                flexWrap: { xs: "wrap", sm: "nowrap" },
              }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={{ xs: 0, sm: 1 }}
                sx={{ alignItems: { sm: "baseline" }, minWidth: 0 }}
              >
                <Typography
                  variant="body1"
                  sx={{ color: "text.primary" }}
                  noWrap
                >
                  {entry.playerName}
                </Typography>
                <Typography
                  variant="numericSm"
                  sx={{ color: "text.secondary" }}
                  suppressHydrationWarning
                >
                  {entry.teamAbbreviation || "—"} ·{" "}
                  {formatEtTime(entry.kickoffLabel)}
                </Typography>
              </Stack>
              {recommended ? (
                <StatusChip label="recommended" tone="accent" />
              ) : null}
            </Stack>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "baseline",
                mt: 0.5,
                flexWrap: "wrap",
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  color: recommended ? "text.primary" : "text.secondary",
                  flex: { sm: "1 1 auto" },
                }}
              >
                {propTitle(prop.statType, prop)}
              </Typography>
              <NumericText size="sm" muted sx={{ color: "text.muted" }}>
                {probabilityGlyph(prop.direction)}
              </NumericText>
              <ProbabilityValue value={prop.modelProbability} size="sm" />
              <PriceValue cents={prop.askCents} size="sm" />
              <EdgeValue points={prop.edgePoints} size="sm" />
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
