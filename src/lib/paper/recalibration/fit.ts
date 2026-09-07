import {
  CORRECTED_PROBABILITY_MAX,
  CORRECTED_PROBABILITY_MIN,
  RECALIBRATION_METHOD,
  SHRINKAGE_K,
} from "../config";

/**
 * Probability Recalibration — the fit.
 *
 * Kelly-family sizing magnifies probability error, particularly at high prices.
 * A model that is systematically overconfident at 80% will propose an
 * irresponsibly large stake on an apparently excellent opportunity, and it will
 * do so most confidently exactly where it is most wrong. So the raw projection
 * probability never reaches sizing: it passes through a stored, versioned,
 * monotone correction fitted from evidence about how the model has actually
 * performed.
 *
 * **The inputs are exhaustively: stored backtest calibration bins, and live
 * graded threshold observations.** No price, no settlement, no recommendation,
 * no decision. A model that has read the market cannot answer whether it beats
 * the market, and a correction fitted against prices would quietly make the
 * calibration surface a measurement of the market rather than of the model.
 * `recalibration-boundary.test.ts` proves this structurally rather than by
 * inspection.
 *
 * Pure module: no Prisma, no env, no clock. `store.ts` supplies the rows.
 */

/** One of the ten fixed tenths, from the stored backtest record. */
export type BacktestBin = {
  /** 0-9, matching `CalibrationBin.binIndex`. */
  binIndex: number;
  predictedMean: number;
  observedRate: number;
  thresholdObservations: number;
};

/** One graded live threshold observation: what was said, what happened. */
export type LiveObservation = {
  statedProbability: number;
  /** Did the threshold event occur? */
  outcome: boolean;
};

export type FitInput = {
  backtestBins: BacktestBin[];
  liveObservations: LiveObservation[];
  /** Live observations at which live weight reaches one half. */
  shrinkageK?: number;
};

/** A monotone piecewise-linear map, anchored at (0,0) and (1,1). */
export type RecalibrationKnots = Array<[raw: number, corrected: number]>;

export type Fit = {
  method: string;
  shrinkageK: number;
  knots: RecalibrationKnots;
  liveObservationCount: number;
  /** Per-bin diagnostics, for the fit record and for review. */
  bins: Array<{
    binIndex: number;
    predictedMean: number;
    backtestObserved: number;
    liveObserved: number | null;
    liveCount: number;
    liveWeight: number;
    blendedObserved: number;
  }>;
};

const BIN_COUNT = 10;

/** The tenth a stated probability falls in. 1.0 belongs to the last bin. */
export function binIndexFor(probability: number): number {
  const index = Math.floor(probability * BIN_COUNT);
  return Math.min(Math.max(index, 0), BIN_COUNT - 1);
}

/**
 * Pool-adjacent-violators, weighted. Returns a non-decreasing sequence that is
 * the weighted-least-squares monotone fit of the input.
 *
 * Monotonicity is not cosmetic here. A correction that dipped — mapping a
 * higher raw probability to a lower corrected one — would let a *more*
 * confident projection receive a *smaller* stake than a less confident one at
 * the same price, which is incoherent as a belief and indefensible as a
 * staking rule. Sparse bins in a real calibration record routinely violate
 * monotonicity by chance, so this runs on every fit rather than only when it
 * looks necessary.
 */
export function pava(values: number[], weights: number[]): number[] {
  if (values.length !== weights.length) {
    throw new Error("pava: values and weights must be the same length");
  }
  // Each block is a pooled run of adjacent points sharing one fitted value.
  const blockValue: number[] = [];
  const blockWeight: number[] = [];
  const blockSize: number[] = [];

  for (let i = 0; i < values.length; i += 1) {
    let value = values[i];
    // A zero-weight point still needs a position; give it a hair of weight so
    // pooling is defined rather than dividing by zero.
    let weight = weights[i] > 0 ? weights[i] : 1e-9;
    let size = 1;

    // Pool backwards while the sequence decreases.
    while (blockValue.length > 0 && blockValue[blockValue.length - 1] > value) {
      const prevValue = blockValue.pop() as number;
      const prevWeight = blockWeight.pop() as number;
      const prevSize = blockSize.pop() as number;
      const totalWeight = prevWeight + weight;
      value = (prevValue * prevWeight + value * weight) / totalWeight;
      weight = totalWeight;
      size += prevSize;
    }

    blockValue.push(value);
    blockWeight.push(weight);
    blockSize.push(size);
  }

  const result: number[] = [];
  for (let b = 0; b < blockValue.length; b += 1) {
    for (let n = 0; n < blockSize[b]; n += 1) result.push(blockValue[b]);
  }
  return result;
}

/**
 * Fits the correction.
 *
 * Shrinkage is per bin, not global: `w = n / (n + K)` with `K = 200`. A bin the
 * live season has barely touched keeps the backtest's answer almost exactly;
 * one with hundreds of graded observations moves most of the way to what
 * actually happened. With no live data at all the fit reproduces the backtest
 * record, which is the required fallback — an unstable correction fitted on
 * eleven games would be worse than no correction, because it would be applied
 * with the same authority.
 */
export function fitRecalibration(input: FitInput): Fit {
  const shrinkageK = input.shrinkageK ?? SHRINKAGE_K;
  if (shrinkageK <= 0) {
    throw new RangeError("shrinkageK must be positive");
  }

  const byIndex = new Map<number, BacktestBin>(
    input.backtestBins.map((bin) => [bin.binIndex, bin]),
  );

  // Bucket the live observations into the same ten fixed tenths the backtest
  // record stored. Using the same axes is what makes the two comparable at all.
  const liveSum = new Array<number>(BIN_COUNT).fill(0);
  const liveCount = new Array<number>(BIN_COUNT).fill(0);
  const liveProbabilitySum = new Array<number>(BIN_COUNT).fill(0);
  for (const observation of input.liveObservations) {
    const index = binIndexFor(observation.statedProbability);
    liveCount[index] += 1;
    liveSum[index] += observation.outcome ? 1 : 0;
    liveProbabilitySum[index] += observation.statedProbability;
  }

  const bins: Fit["bins"] = [];
  for (let index = 0; index < BIN_COUNT; index += 1) {
    const backtest = byIndex.get(index);
    const n = liveCount[index];
    const hasBacktest = backtest !== undefined;
    if (!hasBacktest && n === 0) continue; // nothing landed here in either record

    // Prefer the backtest's predicted mean as the knot's x-coordinate: it is
    // the larger, more stable sample. Fall back to the live mean for a bin the
    // backtest never populated, and to the bin's midpoint if neither has one.
    const predictedMean = hasBacktest
      ? backtest.predictedMean
      : n > 0
        ? liveProbabilitySum[index] / n
        : (index + 0.5) / BIN_COUNT;

    const backtestObserved = hasBacktest
      ? backtest.observedRate
      : predictedMean;
    const liveObserved = n > 0 ? liveSum[index] / n : null;
    const liveWeight = n / (n + shrinkageK);
    const blendedObserved =
      liveObserved === null
        ? backtestObserved
        : liveWeight * liveObserved + (1 - liveWeight) * backtestObserved;

    bins.push({
      binIndex: index,
      predictedMean,
      backtestObserved,
      liveObserved,
      liveCount: n,
      liveWeight,
      blendedObserved,
    });
  }

  bins.sort((a, b) => a.predictedMean - b.predictedMean);

  // Weight the monotone fit by total evidence in each bin, so a bin with three
  // observations cannot drag a bin with three thousand.
  const monotone = pava(
    bins.map((bin) => bin.blendedObserved),
    bins.map(
      (bin) =>
        bin.liveCount + (byIndex.get(bin.binIndex)?.thresholdObservations ?? 0),
    ),
  );

  const knots: RecalibrationKnots = [[0, 0]];
  for (let i = 0; i < bins.length; i += 1) {
    const x = clamp(bins[i].predictedMean, 0, 1);
    const y = clamp(monotone[i], 0, 1);
    // Skip a knot that would duplicate an anchor's x-coordinate; interpolation
    // needs strictly increasing x.
    if (x <= knots[knots.length - 1][0] || x >= 1) continue;
    knots.push([x, Math.max(y, knots[knots.length - 1][1])]);
  }
  knots.push([1, 1]);

  return {
    method: RECALIBRATION_METHOD,
    shrinkageK,
    knots,
    liveObservationCount: input.liveObservations.length,
    bins,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Applies a fit: piecewise-linear interpolation over its knots, clamped away
 * from certainty.
 *
 * Clamping matters more than it looks. A corrected probability of exactly 0 or
 * 1 makes the Kelly arithmetic degenerate — an infinite edge on one side, an
 * undefined one on the other — and the model is never entitled to certainty
 * about a football outcome anyway.
 */
export function applyKnots(
  knots: RecalibrationKnots,
  rawProbability: number,
): number {
  if (!Number.isFinite(rawProbability)) {
    throw new RangeError("rawProbability must be finite");
  }
  if (knots.length < 2) {
    throw new Error("a fit needs at least the two anchor knots");
  }

  const x = clamp(rawProbability, 0, 1);
  let corrected = knots[knots.length - 1][1];

  for (let i = 1; i < knots.length; i += 1) {
    const [x0, y0] = knots[i - 1];
    const [x1, y1] = knots[i];
    if (x <= x1) {
      const span = x1 - x0;
      corrected = span <= 0 ? y1 : y0 + ((x - x0) / span) * (y1 - y0);
      break;
    }
  }

  return clamp(corrected, CORRECTED_PROBABILITY_MIN, CORRECTED_PROBABILITY_MAX);
}

/** Structural check: knots must be strictly increasing in x, non-decreasing in y. */
export function assertValidKnots(knots: RecalibrationKnots): void {
  if (knots.length < 2) throw new Error("a fit needs at least two knots");
  const [firstX, firstY] = knots[0];
  const [lastX, lastY] = knots[knots.length - 1];
  if (firstX !== 0 || firstY !== 0)
    throw new Error("knots must start at (0,0)");
  if (lastX !== 1 || lastY !== 1) throw new Error("knots must end at (1,1)");
  for (let i = 1; i < knots.length; i += 1) {
    if (knots[i][0] <= knots[i - 1][0]) {
      throw new Error("knot x-coordinates must be strictly increasing");
    }
    if (knots[i][1] < knots[i - 1][1]) {
      throw new Error("knot y-coordinates must be non-decreasing");
    }
  }
}
