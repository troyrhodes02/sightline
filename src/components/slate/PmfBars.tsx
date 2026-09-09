"use client";

import { useId } from "react";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

/**
 * The PMF bar chart — the discrete twin of `DistributionSummary`, for the
 * low-count stat types the Simulation Engine stores as an explicit PMF over
 * `0..K` plus a `(K+1)+` tail bucket. The bars at or above `ceil(threshold)`
 * ARE the displayed probability; the chart exists to make that identity
 * visible, exactly as the continuous curve does.
 *
 * Every colour, font, and stroke reads from the MUI theme — Recharts knows
 * nothing about the theme. Screen readers get the text equivalent, not the SVG.
 */
export function PmfBars({
  pmf,
  threshold,
  probability,
  unitLabel,
}: {
  pmf: number[];
  threshold: number;
  probability: number | null;
  unitLabel: string;
}) {
  const theme = useTheme();
  const labelId = useId();

  const cut = Math.ceil(threshold);
  const data = pmf.map((mass, index) => ({
    // The last slot is the aggregated (K+1)+ tail bucket.
    label: index === pmf.length - 1 ? `${index}+` : String(index),
    mass,
    atOrAbove: index >= cut,
  }));

  const summary =
    probability !== null
      ? `${(probability * 100).toFixed(1)}% of projected outcomes reach ${threshold} ${unitLabel}.`
      : `Distribution summary; threshold ${threshold} ${unitLabel}.`;

  return (
    <Box>
      <Box
        role="img"
        aria-labelledby={labelId}
        sx={{ height: 120, width: "100%" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis
              dataKey="label"
              tick={{
                fill: theme.palette.text.secondary,
                fontSize: 12,
                fontFamily: theme.typography.fontFamily,
              }}
              tickLine={false}
              axisLine={{ stroke: theme.palette.divider }}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Bar dataKey="mass" isAnimationActive={false}>
              {data.map((point) => (
                <Cell
                  key={point.label}
                  fill={
                    point.atOrAbove
                      ? theme.palette.primary.main
                      : theme.palette.primary.soft
                  }
                  fillOpacity={point.atOrAbove ? 0.6 : 1}
                  stroke={theme.palette.primary.main}
                  strokeWidth={1}
                />
              ))}
            </Bar>
            <ReferenceLine
              x={cut - 0.5}
              stroke={theme.palette.text.secondary}
              strokeDasharray="4 3"
            />
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <Typography
        id={labelId}
        variant="caption"
        sx={{ color: "text.muted", display: "block", mt: 0.5 }}
      >
        {summary} The filled bars at or above {cut} are the probability.
      </Typography>
    </Box>
  );
}
