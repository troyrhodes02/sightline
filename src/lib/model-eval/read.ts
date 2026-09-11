import "server-only";

import { prisma } from "@/lib/prisma";
import { activeRecalibration } from "@/lib/paper/recalibration/store";
import {
  applyKnots,
  type RecalibrationKnots,
} from "@/lib/paper/recalibration/fit";
import type { ActiveRecalibration } from "@/lib/paper/recalibration/apply";
import type {
  ComparisonPopulation,
  EvidenceRecord,
  ModelSeriesDto,
} from "@/lib/dto/model-eval";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * The model-comparison read — one model's evidence in, one series out.
 *
 * **Recalibration fairness is structural (D4).** `readModelSeries` takes a
 * `modelVersion` and NOTHING ELSE that could stand in for a correction. It
 * resolves that exact model's own `RecalibrationFit` internally, through
 * `activeRecalibration(modelVersion)`. There is no `fit` parameter, no options
 * object carrying a correction, no overload, and no default that would let a
 * caller pair one model's projections with another model's fit. A comparison
 * (see `comparison.ts`) is assembled from two INDEPENDENT calls to this
 * function, each with its own version — the crossing that D4 forbids is not
 * expressible through this API, and `read.test.ts` proves it from the source.
 *
 * Everything here is an aggregate over durable grade rows and the stored fit.
 * Nothing triggers grading, a refit, or recomputation; nothing is written back.
 * No price, snapshot, decision, or settlement is read — the comparison is a
 * function of graded model outcomes and each model's own calibration.
 */

/**
 * One model's independently-read Brier + sample under its OWN fit, for a
 * (record, population) scope.
 *
 * The `modelVersion` is the only model-identifying input. The fit is resolved
 * from it here — a caller cannot supply, override, or cross it. `statType`
 * narrows the population (by-stat leaders); `null` pools across stats (overall,
 * contract-like — D1). It never selects a correction.
 */
export async function readModelSeries(
  modelVersion: string,
  record: EvidenceRecord,
  population: ComparisonPopulation,
  statType: StatType | null = null,
): Promise<ModelSeriesDto> {
  // The model's OWN correction. Resolved from the version, never passed in.
  // A model with no active fit is scored on its raw probabilities (fit === null
  // → identity), never on a neighbour's map (the whole point of D4).
  const fit = await activeRecalibration(modelVersion);
  const knots = fit?.knots ?? null;

  const { brier, observations } =
    record === "live"
      ? await liveBrier(modelVersion, population, statType, knots)
      : await backtestBrier(modelVersion, population, statType, knots);

  return {
    modelVersion,
    record,
    population,
    brier,
    observations,
    recalibrationVersion: fit?.version ?? null,
  };
}

/** Corrects a raw probability under a fit, or returns it unchanged if none. */
function correct(knots: RecalibrationKnots | null, raw: number): number {
  return knots === null ? raw : applyKnots(knots, raw);
}

// ---------------------------------------------------------------------------
// Live record — deduped per (model, contract), latest pre-kickoff (D3)
// ---------------------------------------------------------------------------

/**
 * Live Brier over the deduped live observation set (D3).
 *
 * Exactly one graded threshold observation per (model, contract): the latest
 * projection whose `computedAt` is strictly before the game's kickoff freeze.
 * Earlier pre-kickoff recomputes are retained in the table but excluded from
 * the count — the `DISTINCT ON` keeps only the newest eligible projection per
 * (model_version, contract). A projection computed at or after kickoff is not
 * live evidence (temporal integrity, backfilling form) and is never eligible.
 *
 * Brier is computed row by row over the CORRECTED probability, so a null
 * (empty sample) is distinct from a real 0.
 */
async function liveBrier(
  modelVersion: string,
  population: ComparisonPopulation,
  statType: StatType | null,
  knots: RecalibrationKnots | null,
): Promise<{ brier: number | null; observations: number }> {
  const stat = statType as string | null;
  const rows = await prisma.$queryRaw<
    Array<{ stated_probability: number; outcome: boolean }>
  >`
    SELECT tg.stated_probability::float8 AS stated_probability, tg.outcome
    FROM threshold_grades tg
    JOIN projections p ON p.id = tg.projection_id
    JOIN games g ON g.id = p.game_id
    WHERE p.id IN (
      SELECT DISTINCT ON (p2.model_version, tg2.contract_id) p2.id
      FROM threshold_grades tg2
      JOIN projections p2 ON p2.id = tg2.projection_id
      JOIN games g2 ON g2.id = p2.game_id
      WHERE p2.model_version = ${modelVersion}
        AND tg2.contract_id IS NOT NULL
        AND p2.computed_at < g2.kickoff_at
        AND (${stat}::text IS NULL OR p2.stat_type::text = ${stat}::text)
      ORDER BY p2.model_version, tg2.contract_id, p2.computed_at DESC
    )
    AND (${population}::text <> 'contract_like' OR tg.contract_like)
    AND (${population}::text <> 'market_linked' OR tg.contract_id IS NOT NULL)`;

  return brierOverRows(
    rows.map((r) => ({
      probability: r.stated_probability,
      outcome: r.outcome,
    })),
    knots,
  );
}

/**
 * Brier over raw per-observation rows, each corrected under the model's own
 * fit. A `contract`-scoped Brier is `mean((corrected − outcome)^2)`.
 */
function brierOverRows(
  rows: Array<{ probability: number; outcome: boolean }>,
  knots: RecalibrationKnots | null,
): { brier: number | null; observations: number } {
  if (rows.length === 0) return { brier: null, observations: 0 };
  let sum = 0;
  for (const row of rows) {
    const corrected = correct(knots, row.probability);
    const y = row.outcome ? 1 : 0;
    sum += (corrected - y) ** 2;
  }
  return { brier: sum / rows.length, observations: rows.length };
}

// ---------------------------------------------------------------------------
// Backtest record — stored contract-like bins, corrected under the model's fit
// ---------------------------------------------------------------------------

/**
 * Backtest Brier from the model's own stored `CalibrationBin` record, corrected
 * under the model's own fit (D4). The harness stores per-bin predicted mean,
 * observed rate, and both denominators for the pooled `contract_like` segment;
 * the bin-level Brier is `sum(n_i * (corrected(mean_i) − observed_i)^2) / N`,
 * which is the population Brier when each bin's members share its mean.
 *
 * The backtest record is version-specific: only THIS model's most-recent
 * completed run with contract-like bins contributes, so a comparison never
 * scores one model's projections against another's backtest.
 */
async function backtestBrier(
  modelVersion: string,
  population: ComparisonPopulation,
  statType: StatType | null,
  knots: RecalibrationKnots | null,
): Promise<{ brier: number | null; observations: number }> {
  // The market-linked population has no stored backtest segment (the harness
  // never sees a live price), so a backtest read there is honestly empty.
  if (population === "market_linked") return { brier: null, observations: 0 };

  // The contract-like segment is stored with population = 'contract_like';
  // every other population is the pooled segment (population NULL). A by-stat
  // backtest reads that stat's bins (statType set); overall reads the pooled
  // stat axis (statType NULL).
  const binPopulation = population === "contract_like" ? "contract_like" : null;

  const run = await prisma.backtestRun.findFirst({
    where: {
      modelVersion,
      status: "completed",
      calibrationBins: { some: { population: binPopulation } },
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true },
  });
  if (!run) return { brier: null, observations: 0 };

  const bins = await prisma.calibrationBin.findMany({
    where: {
      backtestRunId: run.id,
      statType,
      season: null,
      era: null,
      population: binPopulation,
    },
    select: {
      predictedMean: true,
      observedRate: true,
      thresholdObservations: true,
    },
  });

  let weighted = 0;
  let total = 0;
  for (const bin of bins) {
    const n = bin.thresholdObservations;
    if (n <= 0) continue;
    const corrected = correct(knots, Number(bin.predictedMean));
    const observed = Number(bin.observedRate);
    weighted += n * (corrected - observed) ** 2;
    total += n;
  }
  if (total === 0) return { brier: null, observations: 0 };
  return { brier: weighted / total, observations: total };
}

export type { ActiveRecalibration };
