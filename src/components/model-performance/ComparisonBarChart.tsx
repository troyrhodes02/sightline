"use client";

import { useId } from "react";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

/**
 * The two-model Brier comparison bar chart (spec §UI integration).
 *
 * Two bars — Baseline and Simulation — on one axis, distinguished the way the
 * reliability overlay distinguishes its two series: by STROKE and by LABEL,
 * never by colour. Both bars wear the same model accent (they are both
 * model-derived values, D19); the Baseline bar is outlined dashed and the
 * Simulation bar solid, so the two survive greyscale. Lower Brier is better, so
 * a shorter bar is the better-calibrated model — the caption says so rather
 * than leaving the direction implicit.
 *
 * Every colour, font, and stroke reads from the MUI theme (Recharts knows
 * nothing of it). The text equivalent — the two values and the leader — is
 * always present for screen readers via the labelled caption.
 *
 * A null Brier (empty sample) is not a zero bar: the whole chart falls back to
 * prose rather than drawing a misleading picture, because a bar of height zero
 * would read as a perfect score.
 */
export function ComparisonBarChart({
  baselineBrier,
  simulationBrier,
}: {
  baselineBrier: number | null;
  simulationBrier: number | null;
}) {
  const theme = useTheme();
  const labelId = useId();

  if (baselineBrier === null || simulationBrier === null) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Not enough evidence to compare the two engines&apos; Brier scores here.
      </Typography>
    );
  }

  const data = [
    { label: "Baseline", brier: baselineBrier, dashed: true },
    { label: "Simulation", brier: simulationBrier, dashed: false },
  ];
  const better = simulationBrier < baselineBrier ? "Simulation" : "Baseline";

  return (
    <Box>
      <Box
        role="img"
        aria-labelledby={labelId}
        sx={{ height: 120, width: "100%" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 40, bottom: 0, left: 8 }}
          >
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="label"
              tick={{
                fill: theme.palette.text.secondary,
                fontSize: 12,
                fontFamily: theme.typography.fontFamily,
              }}
              tickLine={false}
              axisLine={{ stroke: theme.palette.divider }}
              width={80}
            />
            <Bar dataKey="brier" isAnimationActive={false} barSize={18}>
              {data.map((point) => (
                <Cell
                  key={point.label}
                  fill={theme.palette.primary.main}
                  fillOpacity={point.dashed ? 0.35 : 0.6}
                  stroke={theme.palette.primary.main}
                  strokeWidth={1.4}
                  strokeDasharray={point.dashed ? "3 3" : undefined}
                />
              ))}
              <LabelList
                dataKey="brier"
                position="right"
                formatter={(value: unknown) =>
                  typeof value === "number" ? value.toFixed(3) : ""
                }
                style={{
                  fill: theme.palette.text.primary,
                  fontSize: 12,
                  fontFamily: theme.typography.fontFamily,
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <Typography
        id={labelId}
        variant="caption"
        sx={{ color: "text.muted", display: "block", mt: 0.5 }}
      >
        Brier — Baseline {baselineBrier.toFixed(3)} (dashed), Simulation{" "}
        {simulationBrier.toFixed(3)} (solid). Lower is better; {better} is
        better calibrated here.
      </Typography>
    </Box>
  );
}
