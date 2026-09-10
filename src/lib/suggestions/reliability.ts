import "server-only";

import { RELIABILITY_MIN_SAMPLE } from "./config";

/**
 * Suggestion Reliability Analytics — the two figures that must NEVER be combined
 * (decision 9, and a run stop-condition). Source Accuracy answers "was the claim
 * right?"; Adjustment Accuracy answers "did reacting help?". They have different
 * denominators (not every correct claim yields a gradable adjustment), are gated
 * independently at the reliability minimum, and there is deliberately no field
 * or function here that sums or averages the two.
 *
 * A rate is `null` below the minimum sample — the surface shows the count and
 * says "not enough evidence yet" rather than a polished percentage from three
 * observations that happened to cooperate.
 */

/** The margin within which a shadow neither improved nor hurt the base. */
export const ADJUSTMENT_NEUTRAL_BAND = 0.0;

export type Rate = {
  /** Successes. */
  numerator: number;
  /** The applicable population (verifiable claims / gradable adjustments). */
  denominator: number;
  /** 0..1, or null when the denominator is below the minimum sample. */
  rate: number | null;
};

export type AdjustmentBreakdown = {
  improved: number;
  hurt: number;
  neutral: number;
};

export type SourceReliabilityDto = {
  source: string;
  sourceAccuracy: Rate;
  adjustmentAccuracy: Rate;
  adjustmentBreakdown: AdjustmentBreakdown;
  minSample: number;
};

export function computeRate(
  numerator: number,
  denominator: number,
  minSample: number = RELIABILITY_MIN_SAMPLE,
): Rate {
  return {
    numerator,
    denominator,
    rate: denominator >= minSample ? numerator / denominator : null,
  };
}

/**
 * How one adjustment fared: did the shadow's error beat the base's against the
 * official line? Both are `ProjectionGrade.absErrorMean`. A grade that never
 * landed (a null error) is not gradable and is excluded by the caller.
 */
export function classifyAdjustment(
  baseAbsError: number,
  shadowAbsError: number,
  band: number = ADJUSTMENT_NEUTRAL_BAND,
): "improved" | "hurt" | "neutral" {
  if (shadowAbsError < baseAbsError - band) return "improved";
  if (shadowAbsError > baseAbsError + band) return "hurt";
  return "neutral";
}

export type SourceCounts = {
  /** Claims graded `correct`. */
  correct: number;
  /** Claims graded correct OR incorrect (verifiable). `unverifiable` excluded. */
  verifiable: number;
};

/**
 * Assemble one source's reliability from its raw counts. The two rates are gated
 * independently; the breakdown sums to the adjustment denominator.
 */
export function assembleReliability(
  source: string,
  sourceCounts: SourceCounts,
  breakdown: AdjustmentBreakdown,
  minSample: number = RELIABILITY_MIN_SAMPLE,
): SourceReliabilityDto {
  const gradable = breakdown.improved + breakdown.hurt + breakdown.neutral;
  return {
    source,
    sourceAccuracy: computeRate(
      sourceCounts.correct,
      sourceCounts.verifiable,
      minSample,
    ),
    // "did reacting help?" counts an improvement as a success; neutral and hurt
    // are not successes. Gated on the gradable population, independent of the
    // source's verifiable population above.
    adjustmentAccuracy: computeRate(breakdown.improved, gradable, minSample),
    adjustmentBreakdown: breakdown,
    minSample,
  };
}
