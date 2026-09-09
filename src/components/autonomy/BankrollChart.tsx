"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { formatCents } from "./primitives";

/**
 * Bankroll history.
 *
 * Recharts knows nothing about the MUI theme, so **every colour, font, and
 * stroke here comes from `useTheme()`**. A hardcoded hex in a chart is the
 * single most likely way this product ends up with two visual systems, and the
 * rule has no exceptions — including for the reference lines.
 *
 * The chart carries a `visuallyHidden` text summary. A reliability curve or a
 * drawdown line that exists only as an SVG is unreadable to a screen reader,
 * and the drawdown story is the reason this chart is on the page.
 */
export function BankrollChart({
  series,
  highWaterMarkCents,
  haltThresholdCents,
}: {
  series: Array<{ at: string; settledCents: number }>;
  highWaterMarkCents: number;
  haltThresholdCents: number | null;
}) {
  const theme = useTheme();

  if (series.length < 2) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Not enough history to plot yet.
      </Typography>
    );
  }

  const values = series.map((point) => point.settledCents);
  const min = Math.min(...values, haltThresholdCents ?? Infinity);
  const max = Math.max(...values, highWaterMarkCents);
  const pad = Math.max(1_000, Math.round((max - min) * 0.1));

  const summary =
    `Bankroll history, ${series.length} points. ` +
    `Starts at ${formatCents(values[0])}, ends at ${formatCents(values[values.length - 1])}. ` +
    `High-water mark ${formatCents(highWaterMarkCents)}.` +
    (haltThresholdCents !== null
      ? ` Drawdown halt threshold ${formatCents(haltThresholdCents)}.`
      : "");

  return (
    <Box>
      <Box sx={{ height: { xs: 180, md: 220 } }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={series.map((point) => ({
              at: point.at,
              settled: point.settledCents,
            }))}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid
              stroke={theme.palette.divider}
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="at"
              tick={{
                fill: theme.palette.text.muted,
                fontFamily: theme.typography.fontFamily,
                fontSize: 11,
              }}
              tickFormatter={(value: string) =>
                new Intl.DateTimeFormat("en-US", {
                  timeZone: "America/New_York",
                  month: "short",
                  day: "numeric",
                }).format(new Date(value))
              }
              stroke={theme.palette.divider}
              minTickGap={40}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              tick={{
                fill: theme.palette.text.muted,
                fontFamily: theme.typography.fontFamily,
                fontSize: 11,
              }}
              tickFormatter={(value: number) =>
                `$${Math.round(value / 100).toLocaleString("en-US")}`
              }
              stroke={theme.palette.divider}
              width={56}
            />
            <ReferenceLine
              y={highWaterMarkCents}
              stroke={theme.palette.text.muted}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            {haltThresholdCents !== null ? (
              <ReferenceLine
                y={haltThresholdCents}
                stroke={theme.palette.error.main}
                strokeDasharray="5 4"
                strokeWidth={1}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="settled"
              stroke={theme.palette.primary.main}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>

      <Typography
        variant="caption"
        sx={{ color: "text.secondary", display: "block", mt: 1 }}
      >
        Settled balance. High-water mark and the drawdown halt threshold are
        drawn as reference lines.
      </Typography>
      <Box component="p" sx={visuallyHidden}>
        {summary}
      </Box>
    </Box>
  );
}

/**
 * MUI's own visually-hidden values.
 *
 * The summary is present in the accessibility tree and absent from the visual
 * one — not `display: none`, which would remove it from both and leave the
 * chart unreadable to a screen reader.
 */
const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
