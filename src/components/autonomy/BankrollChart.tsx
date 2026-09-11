"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
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
 * The three-portfolio bankroll history (PME-6, Performance).
 *
 * Baseline / Simulation / Hybrid as three lines under identical assumptions,
 * every colour and stroke from the theme. Reference lines: the highest of the
 * portfolios' high-water marks and, when present, the halt threshold. A text
 * summary rides along in the accessibility tree.
 *
 * Series are aligned by point index rather than by timestamp — each portfolio
 * has its own ledger cadence, so a shared time axis would require interpolation
 * the ledger does not support. The x axis therefore shows the union of
 * timestamps and each line is plotted at its own points; a portfolio with fewer
 * points simply ends earlier. This is a diagnostic overlay, not a settlement
 * record, so index alignment is faithful enough.
 */
export function MultiBankrollChart({
  series,
  highWaterMarkCents,
  haltThresholdCents,
}: {
  series: Array<{
    portfolio: "baseline" | "simulation" | "hybrid";
    points: Array<{ at: string; settledCents: number }>;
  }>;
  highWaterMarkCents: number;
  haltThresholdCents: number | null;
}) {
  const theme = useTheme();

  const plotted = series.filter((s) => s.points.length >= 2);
  if (plotted.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Not enough history to plot yet.
      </Typography>
    );
  }

  const COLOURS: Record<string, string> = {
    baseline: theme.palette.primary.main,
    simulation: theme.palette.market.main,
    hybrid: theme.palette.warning.main,
  };

  // Union of point indices; each series contributes its own value at each index.
  const maxLen = Math.max(...plotted.map((s) => s.points.length));
  const data = Array.from({ length: maxLen }, (_, index) => {
    const row: Record<string, number | string> = { index };
    for (const s of plotted) {
      const point = s.points[index];
      if (point) row[s.portfolio] = point.settledCents;
    }
    return row;
  });

  const allValues = plotted.flatMap((s) => s.points.map((p) => p.settledCents));
  const min = Math.min(...allValues, haltThresholdCents ?? Infinity);
  const max = Math.max(...allValues, highWaterMarkCents);
  const pad = Math.max(1_000, Math.round((max - min) * 0.1));

  const summary =
    `Bankroll history across ${plotted.length} portfolio${plotted.length === 1 ? "" : "s"}. ` +
    plotted
      .map(
        (s) =>
          `${s.portfolio} ends at ${formatCents(s.points[s.points.length - 1].settledCents)}`,
      )
      .join("; ") +
    `. High-water mark ${formatCents(highWaterMarkCents)}.` +
    (haltThresholdCents !== null
      ? ` Drawdown halt threshold ${formatCents(haltThresholdCents)}.`
      : "");

  return (
    <Box>
      <Box sx={{ height: { xs: 180, md: 220 } }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid
              stroke={theme.palette.divider}
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="index"
              tick={{
                fill: theme.palette.text.muted,
                fontFamily: theme.typography.fontFamily,
                fontSize: 11,
              }}
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
            {plotted.map((s) => (
              <Line
                key={s.portfolio}
                type="monotone"
                dataKey={s.portfolio}
                stroke={COLOURS[s.portfolio]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
        {plotted.map((s) => (
          <Stack
            key={s.portfolio}
            direction="row"
            spacing={0.75}
            sx={{ alignItems: "center" }}
          >
            <Box
              sx={{
                width: 14,
                height: 2,
                backgroundColor: COLOURS[s.portfolio],
              }}
            />
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", textTransform: "capitalize" }}
            >
              {s.portfolio}
            </Typography>
          </Stack>
        ))}
      </Stack>
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
