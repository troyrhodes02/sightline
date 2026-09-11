/**
 * The model-comparison evidence layer (Parallel Model Evaluation, PME-3).
 *
 * Public surface for SIG-105's Model Performance surface and the contract-detail
 * track-record block. The read functions resolve each model's own fit (D4); the
 * leader / recommendation functions are pure and side-effect-free (D1/D12).
 */
export {
  readComparison,
  readStatLeaders,
  readRecommendation,
} from "./comparison";
export { readModelSeries } from "./read";
export { readContractTrackRecord } from "./track-record";
export {
  determineLeader,
  recommendation,
  evidenceStrength,
  belowFloor,
  sampleFloor,
} from "./leader";
export {
  BASELINE_VERSION,
  SIMULATION_VERSION,
  LEADER_BRIER_MARGIN,
  LIVE_SAMPLE_FLOOR,
  BACKTEST_SAMPLE_FLOOR,
  TRACK_RECORD_BUCKET_FLOOR,
  SIMULATION_SUPPORTED_STATS,
  modelSupportsStat,
} from "./config";
export type {
  LeaderState,
  EvidenceStrength,
  EvidenceRecord,
  ComparisonPopulation,
  ModelSeriesDto,
  ModelComparisonDto,
  StatLeaderRowDto,
  ModelRecommendationDto,
  ContractTrackRecordDto,
} from "@/lib/dto/model-eval";
