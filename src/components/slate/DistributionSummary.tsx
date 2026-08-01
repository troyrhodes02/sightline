"use client";

import { useId } from "react";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

/**
 * The distribution summary — the most important graphic in the product. The
 * filled mass at or above the Kalshi threshold IS the displayed probability;
 * the chart exists to make that identity visible, not to decorate it.
 *
 * A density silhouette is rebuilt from the stored quantile grid (Δp/Δx
 * between adjacent quantiles). Every colour, font, and stroke reads from the
 * MUI theme — Recharts knows nothing about the theme, so a hardcoded hex
 * here is how the product ends up with two visual systems.
 *
 * Screen readers get the text equivalent, not the SVG.
 */
export function DistributionSummary({
  quantiles,
  threshold,
  probability,
  unitLabel,
}: {
  quantiles: Record<string, number>;
  threshold: number;
  probability: number | null;
  unitLabel: string;
}) {
  const theme = useTheme();
  const labelId = useId();

  const points = Object.entries(quantiles)
    .map(([key, value]) => ({
      p: Number(key.replace("q", "")) / 100,
      x: value,
    }))
    .filter((point) => Number.isFinite(point.p) && Number.isFinite(point.x))
    .sort((a, b) => a.p - b.p);

  const distinctX = new Set(points.map((point) => point.x));
  const summary =
    probability !== null
      ? `${(probability * 100).toFixed(1)}% of projected outcomes reach ${threshold} ${unitLabel}.`
      : `Distribution summary; threshold ${threshold} ${unitLabel}.`;

  if (points.length < 4 || distinctX.size < 3) {
    // Too degenerate to draw honestly (near-point mass). The text carries it.
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {summary}
      </Typography>
    );
  }

  type DensityPoint = { x: number; below: number | null; above: number | null };
  const density: DensityPoint[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (b.x <= a.x) continue;
    const mid = (a.x + b.x) / 2;
    const d = (b.p - a.p) / (b.x - a.x);
    density.push({
      x: mid,
      below: mid < threshold ? d : null,
      above: mid >= threshold ? d : null,
    });
  }
  // Duplicate the boundary point into both series so the areas meet at the
  // threshold instead of leaving a gap.
  const boundaryIndex = density.findIndex((point) => point.x >= threshold);
  if (boundaryIndex > 0) {
    const boundary = density[boundaryIndex];
    density.splice(boundaryIndex, 0, {
      x: boundary.x,
      below: boundary.above,
      above: boundary.above,
    });
  }

  return (
    <Box>
      <Box
        role="img"
        aria-labelledby={labelId}
        sx={{ height: 120, width: "100%" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={density}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{
                fill: theme.palette.text.secondary,
                fontSize: 12,
                fontFamily: theme.typography.fontFamily,
              }}
              tickLine={false}
              axisLine={{ stroke: theme.palette.divider }}
              tickCount={5}
            />
            <YAxis hide />
            <Area
              dataKey="below"
              stroke={theme.palette.primary.main}
              strokeWidth={1.5}
              fill={theme.palette.primary.soft}
              fillOpacity={1}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Area
              dataKey="above"
              stroke={theme.palette.primary.main}
              strokeWidth={1.5}
              fill={theme.palette.primary.main}
              fillOpacity={0.35}
              isAnimationActive={false}
              connectNulls={false}
            />
            <ReferenceLine
              x={threshold}
              stroke={theme.palette.text.secondary}
              strokeDasharray="4 3"
              label={{
                value: String(threshold),
                position: "top",
                fill: theme.palette.text.secondary,
                fontSize: 12,
                fontFamily: theme.typography.fontFamily,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
      <Typography
        id={labelId}
        variant="caption"
        sx={{ color: "text.muted", display: "block", mt: 0.5 }}
      >
        {summary} The filled area at or above {threshold} is the probability.
      </Typography>
    </Box>
  );
}
