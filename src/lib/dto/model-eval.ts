import type { StatType } from "../../../generated/prisma/enums";

/**
 * The model-comparison evidence layer's contracts (spec §UI data contracts).
 *
 * Contract rules that must survive refactors:
 *
 * - `null` and `0` are different states everywhere. A Brier that was not
 *   computed (no evidence, or a side empty) is `null`, never zero — a stored
 *   zero would be read as a perfect score.
 * - Live and Backtest are two labelled records (D15). A DTO carries exactly one
 *   `record`; nothing here blends them into a single count or score.
 * - Every leader state that is not `not_enough_evidence` carries its margin and
 *   both sample counts (D14) — the number is never shown without its evidence.
 * - Each model's Brier is measured under its OWN `RecalibrationFit` keyed by
 *   `modelVersion` (D4). The `baselineModelVersion` / `simulationModelVersion`
 *   fields name which record each Brier belongs to so the two can never be
 *   confused for one another.
 */

export type LeaderState =
  | "simulation_leads"
  | "baseline_leads"
  | "too_close_to_call"
  | "not_enough_evidence";

export type EvidenceStrength = "strong" | "moderate" | "limited";
export type EvidenceRecord = "live" | "backtest";
export type ComparisonPopulation = "contract_like" | "all" | "market_linked";

/**
 * One model's independently-read series for a (record, population) scope. Read
 * under this model's own fit; a comparison assembles two of these and never
 * pairs one model's projections with another's correction (D4).
 */
export type ModelSeriesDto = {
  modelVersion: string;
  record: EvidenceRecord;
  population: ComparisonPopulation;
  /** Brier of the recalibrated probability, or null when the sample is empty. */
  brier: number | null;
  /** Deduped per (model, contract) for live (D3); raw for backtest. */
  observations: number;
  /** The fit version that corrected this model's probabilities, or null. */
  recalibrationVersion: number | null;
};

export type ModelComparisonDto = {
  record: EvidenceRecord;
  population: ComparisonPopulation;
  leader: LeaderState;
  baselineBrier: number | null;
  simulationBrier: number | null;
  /** abs(baseline − simulation); null if a side is empty. */
  brierMargin: number | null;
  baselineModelVersion: string;
  simulationModelVersion: string;
  /** Deduped per (model, contract) — D3. Zero for a backtest record. */
  liveObservations: number;
  backtestObservations: number;
  evidence: EvidenceStrength;
};

export type StatLeaderRowDto = {
  statType: StatType;
  leader: LeaderState;
  brierMargin: number | null;
  /** For the selected record's population. */
  sampleSize: number;
  evidence: EvidenceStrength;
  /** Sample under the record's applicable minimum floor. */
  belowFloor: boolean;
};

/**
 * The plain-language recommendation (D12). Decision support only — this is a
 * DTO, never a config write. `canRecommend` is false whenever the evidence
 * cannot support a recommendation, and the text says so honestly rather than
 * inventing a verdict on a thin sample.
 */
export type ModelRecommendationDto = {
  /** The overall leader the recommendation is built from. */
  leader: LeaderState;
  /** True only when a model leads with sufficient, non-trivial evidence. */
  canRecommend: boolean;
  /** The model the text recommends considering, or null when it recommends none. */
  recommendedModelVersion: string | null;
  /** One or two plain-language sentences. Never a control, never a config. */
  text: string;
};
