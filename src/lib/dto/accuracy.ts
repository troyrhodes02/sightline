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
  /**
   * A concrete model version, `"all"` (the labelled combined view "All versions
   * (deployed system)"), or `"lifetime"` — the combined-across-model-versions
   * view (Baseline + Simulation Engine), clearly labelled and NEVER the
   * resolved default. Default is the active model (latest deployed with graded
   * data), so live-readiness and this surface agree on the active record.
   */
  modelVersion: string | "all" | "lifetime";
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
  /**
   * The model version this series measures: a concrete version, `"lifetime"`
   * (the combined-across-versions view), or `null` when a version is not
   * meaningful (a pooled backtest run carries its version in the label). Never
   * implied by the label alone — Compare renders two versions and must keep
   * them apart structurally.
   */
  modelVersion: string | "lifetime" | null;
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

/**
 * The plain-language layer (Pitch 10, Slate Experience & Prop Research). It
 * INTERPRETS the metrics already computed for the panels below it — it computes
 * no new metric and reads nothing the advanced panels do not. Every rate carries
 * its two denominators, and a thin sample reads as "not enough evidence yet",
 * never as a bad score.
 */
export type AccuracySummaryDto = {
  /**
   * `provisional` when the active record's sample is below the reporting floor;
   * otherwise `calibrated` or `drifting` from the reliability of the populated
   * buckets. Never a fabricated verdict on a thin sample.
   */
  verdict: "calibrated" | "provisional" | "drifting";
  /** Both denominators for the active record, always shown with the verdict. */
  thresholdObservations: number;
  projectionCount: number;
  /** The active record's Brier, or null when it could not be computed. */
  brier: number | null;
  /** Concise interpretation, not a tutorial. */
  brierGloss: string;
  /** One-line answers to William's real questions. */
  calibrationVerdict: string;
  baselineVerdict: string;
  /** Insufficient market sample reads as not-enough-evidence, never poor. */
  marketVerdict: string;
  /**
   * `insufficient` when there are not enough graded weeks to establish a trend
   * — stated honestly rather than guessed from one aggregate.
   */
  trend: "improving" | "stable" | "deteriorating" | "insufficient";
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
  /**
   * The plain-language summary rendered above the advanced panels. Optional so
   * older fixtures remain valid; `readAccuracy` always attaches it.
   */
  summary?: AccuracySummaryDto;
  /** ADMIN SERIALIZER ONLY — key absent for viewers, never null. */
  overridesEntry?: { decisionCount: number };
};
