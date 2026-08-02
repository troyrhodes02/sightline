import type { StatType } from "../../../generated/prisma/enums";

/**
 * The accuracy surface's contracts (spec §12).
 *
 * Contract rules that must survive refactors:
 *
 * - `null` and `0` are different states everywhere. A metric that was not
 *   computed is `null`, never zero — a stored zero would be read as a
 *   measurement.
 * - Every rate travels with its counts in the same object; `SampleSizePair`
 *   renders them together so the two-denominator rule cannot be half-applied.
 * - Compare never merges: `calibration` carries one or two labelled series,
 *   each with its own buckets, Brier, and denominators.
 * - **`overridesEntry` is added by the admin serializer and never nulled for
 *   viewers** — the key is absent, not null, so a viewer payload is
 *   structurally decision-free.
 */

export type AccuracyScope = {
  record: "live" | "backtest" | "compare";
  /** `"all"` is the labelled combined view: "All versions (deployed system)". */
  modelVersion: string | "all";
  population: "contract_like" | "all" | "market_linked";
  statType: StatType | "all";
  season: number | "all";
};

export type CalibrationBucketDto = {
  /** 0–9, fixed tenths — matching the stored backtest `binIndex` axes. */
  binIndex: number;
  binLow: number;
  binHigh: number;
  predictedMean: number | null;
  observedRate: number | null;
  thresholdObservations: number;
  projectionCount: number;
  belowFloor: boolean;
};

export type CalibrationSeriesDto = {
  kind: "live" | "backtest";
  /** Names the record and carries both denominators. */
  label: string;
  brier: number | null;
  thresholdObservations: number;
  projectionCount: number;
  buckets: CalibrationBucketDto[];
  /** Backtest only: the reanalysis-era split disclosure line. */
  eraDisclosure: string | null;
};

export type ErrorPanelDto = {
  projectionCount: number;
  model: { mae: number; rmse: number } | null;
  seasonAverage: { mae: number; rmse: number } | null;
  trailingFive: { mae: number; rmse: number } | null;
  /** Disclosed for visibility, never a baseline head-to-head. */
  medianMae: number | null;
};

export type MarketComparisonDto =
  | { state: "insufficient"; graded: number; required: 30 }
  | {
      state: "ready";
      thresholdObservations: number;
      projectionCount: number;
      modelBrier: number;
      marketBrier: number;
      /** Executable side, at the final pre-kickoff observation. */
      meanEdgePoints: number;
      /** The edge is never rendered without these. */
      ci95Low: number;
      ci95High: number;
      /** Labelled secondary; null when the needed book side was unavailable. */
      midpointEdgePoints: number | null;
    };

export type OverrideDecisionRowDto = {
  contractId: string;
  decidedAt: string;
  playerName: string;
  statType: StatType;
  threshold: number;
  disposition: "took" | "faded" | "skipped";
  /** Oriented to the decision's side — for a fade, the side he preferred. */
  edgeAtDecision: number | null;
  edgeAtFinal: number | null;
  /** Final minus decision edge; positive = waiting would have been better. */
  timingCostPoints: number | null;
  timingUnavailableReason:
    "missing_final_snapshot" | "voided" | "side_unavailable" | null;
  /** Skips carry NO win/loss language — settlement shown descriptively. */
  outcome: "won" | "lost" | "voided" | "pending" | "settled_yes" | "settled_no";
  sourcesDisagree: boolean;
};

export type OverridesDto = {
  scope: { statType: StatType | "all"; season: number | "all" };
  tiles: {
    took: {
      total: number;
      settled: number;
      won: number;
      lost: number;
      voided: number;
      pending: number;
    };
    faded: {
      total: number;
      settled: number;
      won: number;
      lost: number;
      voided: number;
      pending: number;
    };
    skipped: {
      total: number;
      settledYes: number;
      settledNo: number;
      voided: number;
      pending: number;
    };
  };
  agreement: {
    disposition: "took" | "faded" | "skipped";
    recommended: { count: number; won: number | null };
    notRecommended: { count: number; won: number | null };
  }[];
  timing: {
    medianPoints: number | null;
    meanPoints: number | null;
    measurable: number;
    total: number;
    unavailable: { reason: string; count: number }[];
  };
  decisions: OverrideDecisionRowDto[];
};

export type AccuracyDto = {
  scope: AccuracyScope;
  gradedThroughWeek: { season: number; week: number } | null;
  lastGradingCycleAt: string | null;
  gradingDelayed: boolean;
  /** One or two entries; compare = two, labelled, never merged. */
  calibration: CalibrationSeriesDto[];
  /** Null renders the designed empty state, not a zero-filled table. */
  errorPanel: ErrorPanelDto | null;
  market: MarketComparisonDto;
  exclusions: { reason: string; count: number }[];
  availableVersions: string[];
  availableSeasons: number[];
  /** ADMIN SERIALIZER ONLY — key absent for viewers, never null. */
  overridesEntry?: { decisionCount: number };
};
