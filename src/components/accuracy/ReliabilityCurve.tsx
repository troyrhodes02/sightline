"use client";

import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { CalibrationBucketDto } from "@/lib/dto/accuracy";

/**
 * The reliability curve — the second sanctioned Recharts wrapper in the
 * codebase, copying `DistributionSummary`'s contract: every colour, font, and
 * stroke reads from the MUI theme, nothing animates, screen readers get the
 * bucket table (via `aria-describedby`) rather than the SVG, and degenerate
 * data renders prose instead of a misleading picture.
 *
 * Compare mode is two labelled series on one set of axes — live in the model
 * accent, backtest muted — never one merged curve. Provisional buckets
 * (below the reporting floor) are hollow with dashed connecting segments:
 * shape carries the distinction, not colour alone.
 */

export type ReliabilitySeries = {
  kind: "live" | "backtest";
  label: string;
  buckets: CalibrationBucketDto[];
};

type Point = {
  x: number;
  y: number;
  belowFloor: boolean;
};

function plottable(buckets: CalibrationBucketDto[]): Point[] {
  return buckets
    .filter(
      (bucket) =>
        bucket.thresholdObservations > 0 &&
        bucket.predictedMean !== null &&
        bucket.observedRate !== null,
    )
    .map((bucket) => ({
      x: bucket.predictedMean as number,
      y: bucket.observedRate as number,
      belowFloor: bucket.belowFloor,
    }));
}

export function ReliabilityCurve({
  series,
  ariaSummaryId,
}: {
  series: ReliabilitySeries[];
  ariaSummaryId: string;
}) {
  const theme = useTheme();
  const colorFor = (kind: "live" | "backtest") =>
    kind === "live" ? theme.palette.primary.main : theme.palette.text.secondary;

  const plotted = series.map((entry) => ({
    ...entry,
    points: plottable(entry.buckets),
  }));
  const totalPoints = plotted.reduce((sum, s) => sum + s.points.length, 0);

  if (totalPoints < 2) {
    // Too little to draw honestly; the bucket table carries what exists.
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Not enough populated buckets to draw a curve — see the bucket table for
        the observations that exist.
      </Typography>
    );
  }

  const tick = {
    fill: theme.palette.text.secondary,
    fontSize: 12,
    fontFamily: theme.typography.fontFamily,
  };
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <Box
      role="img"
      aria-label="Reliability curve: stated probability against observed rate"
      aria-describedby={ariaSummaryId}
      sx={{ height: 240, width: "100%" }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={percent}
            tick={tick}
            tickLine={false}
            axisLine={{ stroke: theme.palette.divider }}
          />
          <YAxis
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={percent}
            tick={tick}
            tickLine={false}
            axisLine={{ stroke: theme.palette.divider }}
            width={44}
          />
          {/* The diagonal: perfect calibration, always drawn for reference. */}
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke={theme.palette.text.secondary}
            strokeOpacity={0.55}
            strokeDasharray="4 4"
            ifOverflow="hidden"
          />
          {plotted.flatMap((entry) => {
            const color = colorFor(entry.kind);
            const width = entry.kind === "live" ? 2 : 1.5;
            const segments = entry.points.slice(0, -1).map((from, index) => {
              const to = entry.points[index + 1];
              const provisional = from.belowFloor || to.belowFloor;
              return (
                <Line
                  key={`${entry.kind}-segment-${index}`}
                  data={[from, to]}
                  dataKey="y"
                  stroke={color}
                  strokeWidth={width}
                  strokeDasharray={provisional ? "3 4" : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            });
            return [
              ...segments,
              <Line
                key={`${entry.kind}-points`}
                data={entry.points}
                dataKey="y"
                stroke="none"
                isAnimationActive={false}
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  payload?: Point;
                }) => (
                  <circle
                    key={`${entry.kind}-point-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill={
                      props.payload?.belowFloor
                        ? theme.palette.background.paper
                        : color
                    }
                    stroke={color}
                    strokeWidth={1.6}
                  />
                )}
              />,
            ];
          })}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
