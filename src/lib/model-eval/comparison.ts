import "server-only";

import { readModelSeries } from "./read";
import {
  belowFloor,
  determineLeader,
  evidenceStrength,
  recommendation,
} from "./leader";
import { BASELINE_VERSION, SIMULATION_VERSION } from "./config";
import type { StatType } from "../../../generated/prisma/enums";
import type {
  ComparisonPopulation,
  EvidenceRecord,
  ModelComparisonDto,
  ModelRecommendationDto,
  ModelSeriesDto,
  StatLeaderRowDto,
} from "@/lib/dto/model-eval";

/**
 * The comparison assembly (D1/D3/D4/D14/D15).
 *
 * A comparison is TWO independent `readModelSeries` calls — one per model,
 * each under its own fit — joined by the pure leader rule. This is where D4's
 * structural guarantee is realised in composition: there is no shared fit and
 * no crossing point. Baseline and Simulation are read separately and the leader
 * is a function of their two Briers, nothing else.
 *
 * Live and Backtest are never blended (D15): a comparison is scoped to exactly
 * one record. Overall pools contract-like across every stat type (statType
 * null); by-stat applies the same rule within each stat's own population.
 */

const STAT_TYPES: StatType[] = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "rushing_tds",
  "receiving_tds",
];

/**
 * The comparison sample size for a record: the deduped live observation count
 * (D3) or the backtest observation count — never their sum (D15). Both models
 * are read on the same record, so the leader's sample is the larger of the two
 * models' own counts (a model with no evidence has zero and drives the leader
 * to `not_enough_evidence` on its own via the null-Brier path).
 */
function sampleFor(
  baseline: ModelSeriesDto,
  simulation: ModelSeriesDto,
): number {
  return Math.max(baseline.observations, simulation.observations);
}

/**
 * One record + population comparison (overall population when statType is null).
 * Reads each model's own series, then applies the pure leader rule.
 */
export async function readComparison(
  record: EvidenceRecord,
  population: ComparisonPopulation,
  statType: StatType | null = null,
): Promise<ModelComparisonDto> {
  // Two independent reads. Neither knows about the other's fit.
  const [baseline, simulation] = await Promise.all([
    readModelSeries(BASELINE_VERSION, record, population, statType),
    readModelSeries(SIMULATION_VERSION, record, population, statType),
  ]);

  const sampleSize = sampleFor(baseline, simulation);
  const { leader, brierMargin } = determineLeader({
    record,
    baselineBrier: baseline.brier,
    simulationBrier: simulation.brier,
    sampleSize,
  });

  return {
    record,
    population,
    leader,
    baselineBrier: baseline.brier,
    simulationBrier: simulation.brier,
    brierMargin,
    baselineModelVersion: BASELINE_VERSION,
    simulationModelVersion: SIMULATION_VERSION,
    liveObservations: record === "live" ? sampleSize : 0,
    backtestObservations: record === "backtest" ? sampleSize : 0,
    evidence: evidenceStrength(record, sampleSize),
  };
}

/**
 * The per-stat leader rows for a record (D1). Each stat is judged in its own
 * contract-like population independently — a stat with a thin sample reads as
 * `not_enough_evidence` without dragging or being dragged by any other stat.
 */
export async function readStatLeaders(
  record: EvidenceRecord,
): Promise<StatLeaderRowDto[]> {
  const rows = await Promise.all(
    STAT_TYPES.map(async (statType): Promise<StatLeaderRowDto> => {
      const comparison = await readComparison(
        record,
        "contract_like",
        statType,
      );
      const sampleSize =
        record === "live"
          ? comparison.liveObservations
          : comparison.backtestObservations;
      return {
        statType,
        leader: comparison.leader,
        brierMargin: comparison.brierMargin,
        sampleSize,
        evidence: comparison.evidence,
        belowFloor: belowFloor(record, sampleSize),
      };
    }),
  );
  return rows;
}

/**
 * The overall recommendation for a record (D12). Built from the pooled
 * contract-like comparison; a pure DTO with no write path. This function reads
 * evidence and returns text — it can no more mutate `ModelSelection` than the
 * leader rule can.
 */
export async function readRecommendation(
  record: EvidenceRecord,
): Promise<ModelRecommendationDto> {
  const overall = await readComparison(record, "contract_like");
  const sampleSize =
    record === "live" ? overall.liveObservations : overall.backtestObservations;
  return recommendation({
    leader: overall.leader,
    record,
    brierMargin: overall.brierMargin,
    sampleSize,
    baselineModelVersion: overall.baselineModelVersion,
    simulationModelVersion: overall.simulationModelVersion,
  });
}
