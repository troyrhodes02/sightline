import type {
  CalibrationBucketDto,
  MarketComparisonDto,
} from "@/lib/dto/accuracy";
import {
  CALIBRATION_BINS,
  MARKET_MIN_GRADED_OBSERVATIONS,
  REPORTING_FLOOR,
} from "./config";

/**
 * Pure derivations behind the accuracy read — everything here is a function of
 * already-fetched rows, so the honesty rules (fixed buckets, both
 * denominators, the interval that never detaches from the edge) are testable
 * without a database.
 */

export type RawBucketRow = {
  binIndex: number;
  thresholdObservations: number;
  projectionCount: number;
  predictedMean: number | null;
  observedRate: number | null;
  /** Stored flag (backtest bins); when absent, derived from the floor. */
  belowFloor?: boolean;
};

/**
 * Fills the ten fixed tenths from sparse aggregation rows. A bucket nothing
 * landed in still exists — the axes are the record's shape, not a property of
 * whichever buckets happened to fill — with null means and zero counts.
 */
export function fixedBuckets(rows: RawBucketRow[]): CalibrationBucketDto[] {
  return Array.from({ length: CALIBRATION_BINS }, (_, binIndex) => {
    const row = rows.find((r) => r.binIndex === binIndex);
    const observations = row?.thresholdObservations ?? 0;
    return {
      binIndex,
      binLow: binIndex / CALIBRATION_BINS,
      binHigh: (binIndex + 1) / CALIBRATION_BINS,
      predictedMean: row?.predictedMean ?? null,
      observedRate: row?.observedRate ?? null,
      thresholdObservations: observations,
      projectionCount: row?.projectionCount ?? 0,
      belowFloor: row?.belowFloor ?? observations < REPORTING_FLOOR,
    };
  });
}

export type MarketObservationInput = {
  /** The snapshot's recommended side. */
  side: "yes" | "no";
  /** The model's P(yes), as stored on the snapshot. */
  modelProbability: number;
  /** Executable ask on `side`, in cents, at the final observation. */
  askCents: number;
  /** Kalshi settlement: did the market resolve yes? (voided excluded upstream) */
  resultYes: boolean;
  projectionId: string | null;
  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
};

/**
 * Model-vs-market at the final pre-kickoff observation, on the executable
 * side. Both Brier scores are computed on the snapshot's side (Brier is
 * side-symmetric for the model, but the market's executable price only exists
 * per side, so the framing is explicit).
 *
 * The mean edge never leaves here without its 95% normal-approximation
 * interval, and below the floor the panel gets the honest running count, not
 * a small-n number.
 */
export function marketComparison(
  observations: MarketObservationInput[],
): MarketComparisonDto {
  if (observations.length < MARKET_MIN_GRADED_OBSERVATIONS) {
    return {
      state: "insufficient",
      graded: observations.length,
      required: MARKET_MIN_GRADED_OBSERVATIONS,
    };
  }

  const n = observations.length;
  const edges: number[] = [];
  const midpointEdges: number[] = [];
  let modelSquaredSum = 0;
  let marketSquaredSum = 0;
  const projectionIds = new Set<string>();

  for (const o of observations) {
    const outcomeOnSide = (o.side === "yes") === o.resultYes ? 1 : 0;
    const modelOnSide =
      o.side === "yes" ? o.modelProbability : 1 - o.modelProbability;
    const askImplied = o.askCents / 100;

    modelSquaredSum += (modelOnSide - outcomeOnSide) ** 2;
    marketSquaredSum += (askImplied - outcomeOnSide) ** 2;
    edges.push(modelOnSide - askImplied);

    // Midpoint needs both sides of the book on the snapshot's side; when the
    // bid was unavailable the observation simply contributes nothing here —
    // the secondary figure is honest about its own smaller basis.
    const bid = o.side === "yes" ? o.yesBidCents : o.noBidCents;
    const ask = o.side === "yes" ? o.yesAskCents : o.noAskCents;
    if (bid !== null && ask !== null) {
      midpointEdges.push(modelOnSide - (bid + ask) / 200);
    }
    if (o.projectionId !== null) projectionIds.add(o.projectionId);
  }

  const mean = edges.reduce((a, b) => a + b, 0) / n;
  const variance = edges.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const halfWidth = 1.96 * Math.sqrt(variance / n);

  return {
    state: "ready",
    thresholdObservations: n,
    projectionCount: projectionIds.size,
    modelBrier: modelSquaredSum / n,
    marketBrier: marketSquaredSum / n,
    meanEdgePoints: mean * 100,
    ci95Low: (mean - halfWidth) * 100,
    ci95High: (mean + halfWidth) * 100,
    midpointEdgePoints:
      midpointEdges.length > 0
        ? (midpointEdges.reduce((a, b) => a + b, 0) / midpointEdges.length) *
          100
        : null,
  };
}
