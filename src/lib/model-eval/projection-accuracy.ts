import "server-only";

import { prisma } from "@/lib/prisma";
import {
  BASELINE_VERSION,
  SIMULATION_VERSION,
  TRACK_RECORD_BUCKET_FLOOR,
} from "./config";
import type {
  EngineErrorDto,
  ProjectionAccuracyRowDto,
} from "@/lib/dto/model-eval";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * Per-stat point-estimate accuracy: how close each engine's projected VALUE
 * landed to the actual game result (Model Performance → Breakdown facet).
 *
 * This is the point-estimate complement to the Brier/calibration comparison: not
 * "when it said 70%, did it happen 70% of the time?" but "how many yards (or
 * receptions) off was the projected number, on average?". It reuses exactly the
 * error the grading layer already stores — `projection_grades.abs_error_mean`,
 * the absolute error of a projection's value against the official result — and
 * the same MAE / RMSE reduction the accuracy surface's error panel uses
 * (`avg(abs_error)` and `sqrt(avg(abs_error^2))`), so the two surfaces agree.
 *
 * Each engine is read from its OWN graded projections (filtered by model
 * version), never blended (D4 spirit). Live grades only — the backtest
 * point-estimate comparison lives on the Advanced tab's error panel.
 */

const SUPPORTED_STATS: StatType[] = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "rushing_tds",
  "receiving_tds",
];

/**
 * A leader in MAE is only named when BOTH engines clear this floor (reuses the
 * product-wide 30-observation display floor, D8) — below it "closer" would be
 * noise. Within this many units of each other (yards / counts) the two are
 * reported "even" rather than crowning a fractional difference.
 */
const CLOSER_FLOOR = TRACK_RECORD_BUCKET_FLOOR;
const NEGLIGIBLE_MAE_DIFF = 0.1;

type Row = {
  model_version: string;
  stat_type: string;
  mae: number | null;
  rmse: number | null;
  n: number;
};

export async function readProjectionAccuracy(): Promise<
  ProjectionAccuracyRowDto[]
> {
  // One grouped pass over the graded, contract-like live projections; pivoted
  // into per-stat rows in TS. Only the two known engine versions are considered.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      p.model_version AS model_version,
      p.stat_type::text AS stat_type,
      avg(pg.abs_error_mean)::float8 AS mae,
      sqrt(avg(power(pg.abs_error_mean, 2)))::float8 AS rmse,
      count(*)::int AS n
    FROM projection_grades pg
    JOIN projections p ON p.id = pg.projection_id
    WHERE pg.status::text = 'graded'
      AND pg.abs_error_mean IS NOT NULL
      AND pg.contract_like
      AND p.model_version IN (${BASELINE_VERSION}, ${SIMULATION_VERSION})
    GROUP BY p.model_version, p.stat_type`;

  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.model_version}:${r.stat_type}`, r);

  return SUPPORTED_STATS.map((stat) => {
    const baseline = toEngine(byKey.get(`${BASELINE_VERSION}:${stat}`));
    const simulation = toEngine(byKey.get(`${SIMULATION_VERSION}:${stat}`));
    return {
      statType: stat,
      baseline,
      simulation,
      closer: closerOf(baseline, simulation),
    };
  });
}

function toEngine(row: Row | undefined): EngineErrorDto {
  return row && row.mae !== null && row.rmse !== null && row.n > 0
    ? { mae: row.mae, rmse: row.rmse, count: row.n }
    : null;
}

function closerOf(
  baseline: EngineErrorDto,
  simulation: EngineErrorDto,
): ProjectionAccuracyRowDto["closer"] {
  // Both engines must have real, floor-clearing samples before naming a winner.
  if (!baseline || !simulation) return null;
  if (baseline.count < CLOSER_FLOOR || simulation.count < CLOSER_FLOOR) {
    return null;
  }
  const diff = baseline.mae - simulation.mae; // positive → simulation is closer
  if (Math.abs(diff) < NEGLIGIBLE_MAE_DIFF) return "even";
  return diff > 0 ? "simulation" : "baseline";
}
