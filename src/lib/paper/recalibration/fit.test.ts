import { SHRINKAGE_K } from "../config";
import {
  applyKnots,
  assertValidKnots,
  binIndexFor,
  fitRecalibration,
  pava,
  type BacktestBin,
  type LiveObservation,
} from "./fit";

/** Ten well-behaved bins where the model is mildly overconfident up top. */
function overconfidentBacktest(): BacktestBin[] {
  const observed = [0.04, 0.13, 0.23, 0.33, 0.44, 0.53, 0.62, 0.69, 0.75, 0.82];
  return observed.map((rate, index) => ({
    binIndex: index,
    predictedMean: (index + 0.5) / 10,
    observedRate: rate,
    thresholdObservations: 1_200,
  }));
}

function liveAt(
  probability: number,
  hits: number,
  misses: number,
): LiveObservation[] {
  return [
    ...Array.from({ length: hits }, () => ({
      statedProbability: probability,
      outcome: true,
    })),
    ...Array.from({ length: misses }, () => ({
      statedProbability: probability,
      outcome: false,
    })),
  ];
}

describe("binIndexFor", () => {
  it("uses the same ten fixed tenths the backtest record stored", () => {
    expect(binIndexFor(0)).toBe(0);
    expect(binIndexFor(0.099)).toBe(0);
    expect(binIndexFor(0.1)).toBe(1);
    expect(binIndexFor(0.55)).toBe(5);
    expect(binIndexFor(0.999)).toBe(9);
  });

  it("puts an exact 1.0 in the last bin rather than off the end", () => {
    expect(binIndexFor(1)).toBe(9);
  });
});

describe("pava", () => {
  it("leaves an already-monotone sequence alone", () => {
    const values = [0.1, 0.2, 0.3, 0.4];
    expect(pava(values, [1, 1, 1, 1])).toEqual(values);
  });

  it("pools a dip into its neighbours", () => {
    const result = pava([0.1, 0.4, 0.2, 0.5], [1, 1, 1, 1]);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
    // The two violating points pool to their mean.
    expect(result[1]).toBeCloseTo(0.3, 10);
    expect(result[2]).toBeCloseTo(0.3, 10);
  });

  it("lets a heavy bin dominate a light one", () => {
    // 3 observations must not drag 3,000. This is why the fit weights by
    // total evidence rather than treating every bin as equally informative.
    const heavy = pava([0.5, 0.1], [3_000, 3]);
    expect(heavy[0]).toBeGreaterThan(0.49);
    const light = pava([0.5, 0.1], [3, 3_000]);
    expect(light[0]).toBeLessThan(0.11);
  });

  it("handles a zero-weight point without dividing by zero", () => {
    const result = pava([0.3, 0.1], [0, 0]);
    expect(result.every((value) => Number.isFinite(value))).toBe(true);
    expect(result[1]).toBeGreaterThanOrEqual(result[0]);
  });

  it("rejects mismatched inputs rather than pairing them silently", () => {
    expect(() => pava([0.1, 0.2], [1])).toThrow();
  });
});

describe("fitRecalibration", () => {
  it("reproduces the backtest record exactly when there is no live evidence", () => {
    // The required fallback. An unstable correction fitted on nothing would be
    // worse than no correction, because it would be applied with the same
    // authority as a well-evidenced one.
    const fit = fitRecalibration({
      backtestBins: overconfidentBacktest(),
      liveObservations: [],
    });
    expect(fit.liveObservationCount).toBe(0);
    for (const bin of fit.bins) {
      expect(bin.liveWeight).toBe(0);
      expect(bin.blendedObserved).toBeCloseTo(bin.backtestObserved, 12);
    }
  });

  it("gives five live observations a weight of 5/205", () => {
    const fit = fitRecalibration({
      backtestBins: overconfidentBacktest(),
      liveObservations: liveAt(0.55, 5, 0),
    });
    const bin = fit.bins.find((b) => b.binIndex === 5);
    expect(bin).toBeDefined();
    expect(bin?.liveCount).toBe(5);
    expect(bin?.liveWeight).toBeCloseTo(5 / (5 + SHRINKAGE_K), 12);
    // The prior still dominates: five perfect results move the bin a couple of
    // points, not to certainty.
    expect(bin?.blendedObserved).toBeGreaterThan(bin!.backtestObserved);
    expect(bin?.blendedObserved).toBeLessThan(bin!.backtestObserved + 0.02);
  });

  it("lets a large live sample move a bin most of the way", () => {
    const fit = fitRecalibration({
      backtestBins: overconfidentBacktest(),
      liveObservations: liveAt(0.55, 800, 200), // 80% observed
    });
    const bin = fit.bins.find((b) => b.binIndex === 5);
    expect(bin?.liveWeight).toBeCloseTo(1000 / 1200, 10);
    expect(bin?.blendedObserved).toBeGreaterThan(0.7);
  });

  it("never lets live evidence overpower the prior in a single step", () => {
    // "Do not let live results immediately overpower the historical prior."
    // Even a perfect small sample stays closer to the prior than to itself.
    const fit = fitRecalibration({
      backtestBins: overconfidentBacktest(),
      liveObservations: liveAt(0.55, 20, 0),
    });
    const bin = fit.bins.find((b) => b.binIndex === 5)!;
    const towardLive = Math.abs(bin.blendedObserved - 1);
    const towardPrior = Math.abs(bin.blendedObserved - bin.backtestObserved);
    expect(towardPrior).toBeLessThan(towardLive);
  });

  it("produces a monotone map even from non-monotone bins", () => {
    const bumpy = overconfidentBacktest();
    bumpy[4].observedRate = 0.61; // above bin 5's 0.53 — a real-world dip
    bumpy[7].observedRate = 0.58; // below bin 6's 0.62
    const fit = fitRecalibration({ backtestBins: bumpy, liveObservations: [] });
    assertValidKnots(fit.knots);
    for (let i = 1; i < fit.knots.length; i += 1) {
      expect(fit.knots[i][1]).toBeGreaterThanOrEqual(fit.knots[i - 1][1]);
      expect(fit.knots[i][0]).toBeGreaterThan(fit.knots[i - 1][0]);
    }
  });

  it("anchors at (0,0) and (1,1)", () => {
    const fit = fitRecalibration({
      backtestBins: overconfidentBacktest(),
      liveObservations: [],
    });
    expect(fit.knots[0]).toEqual([0, 0]);
    expect(fit.knots[fit.knots.length - 1]).toEqual([1, 1]);
  });

  it("records the method and shrinkage constant on the fit", () => {
    const fit = fitRecalibration({
      backtestBins: overconfidentBacktest(),
      liveObservations: [],
    });
    expect(fit.method).toBe("pava_piecewise_linear/v1");
    expect(fit.shrinkageK).toBe(SHRINKAGE_K);
  });

  it("is deterministic: the same inputs give byte-identical knots", () => {
    const input = {
      backtestBins: overconfidentBacktest(),
      liveObservations: liveAt(0.65, 40, 30),
    };
    expect(JSON.stringify(fitRecalibration(input).knots)).toBe(
      JSON.stringify(fitRecalibration(input).knots),
    );
  });

  it("survives a backtest record with gaps", () => {
    const sparse = overconfidentBacktest().filter((bin) =>
      [0, 4, 9].includes(bin.binIndex),
    );
    const fit = fitRecalibration({
      backtestBins: sparse,
      liveObservations: [],
    });
    assertValidKnots(fit.knots);
    expect(fit.bins).toHaveLength(3);
  });

  it("still fits a bin the backtest never populated but live evidence did", () => {
    const sparse = overconfidentBacktest().filter((bin) => bin.binIndex !== 3);
    const fit = fitRecalibration({
      backtestBins: sparse,
      liveObservations: liveAt(0.35, 60, 40),
    });
    const bin = fit.bins.find((b) => b.binIndex === 3);
    expect(bin).toBeDefined();
    expect(bin?.liveCount).toBe(100);
  });

  it("rejects a non-positive shrinkage constant", () => {
    expect(() =>
      fitRecalibration({
        backtestBins: overconfidentBacktest(),
        liveObservations: [],
        shrinkageK: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("applyKnots", () => {
  const fit = fitRecalibration({
    backtestBins: overconfidentBacktest(),
    liveObservations: [],
  });

  it("corrects an overconfident probability downward", () => {
    // The whole reason the ceiling and the correction both exist: at the top
    // end the model says more than the record supports.
    expect(applyKnots(fit.knots, 0.85)).toBeLessThan(0.85);
  });

  it("is monotone across the whole range", () => {
    let previous = -1;
    for (let raw = 0; raw <= 1.0001; raw += 0.01) {
      const corrected = applyKnots(fit.knots, Math.min(raw, 1));
      expect(corrected).toBeGreaterThanOrEqual(previous);
      previous = corrected;
    }
  });

  it("clamps away from certainty at both ends", () => {
    // A corrected probability of exactly 0 or 1 makes the Kelly arithmetic
    // degenerate, and the model is never entitled to certainty about a
    // football outcome.
    expect(applyKnots(fit.knots, 0)).toBeGreaterThanOrEqual(0.001);
    expect(applyKnots(fit.knots, 1)).toBeLessThanOrEqual(0.999);
  });

  it("clamps an out-of-range input rather than extrapolating", () => {
    expect(applyKnots(fit.knots, -0.5)).toBeGreaterThanOrEqual(0.001);
    expect(applyKnots(fit.knots, 1.5)).toBeLessThanOrEqual(0.999);
  });

  it("interpolates linearly between knots", () => {
    const knots: Array<[number, number]> = [
      [0, 0],
      [0.5, 0.4],
      [1, 1],
    ];
    expect(applyKnots(knots, 0.25)).toBeCloseTo(0.2, 10);
    expect(applyKnots(knots, 0.75)).toBeCloseTo(0.7, 10);
  });

  it("rejects a non-finite input and a degenerate fit", () => {
    expect(() => applyKnots(fit.knots, Number.NaN)).toThrow(RangeError);
    expect(() => applyKnots([[0, 0]], 0.5)).toThrow();
  });
});

describe("assertValidKnots", () => {
  it("requires both anchors", () => {
    expect(() =>
      assertValidKnots([
        [0.1, 0.1],
        [1, 1],
      ]),
    ).toThrow();
    expect(() =>
      assertValidKnots([
        [0, 0],
        [0.9, 0.9],
      ]),
    ).toThrow();
  });

  it("rejects a decreasing map", () => {
    expect(() =>
      assertValidKnots([
        [0, 0],
        [0.4, 0.6],
        [0.6, 0.5],
        [1, 1],
      ]),
    ).toThrow();
  });

  it("rejects duplicated x-coordinates", () => {
    expect(() =>
      assertValidKnots([
        [0, 0],
        [0.4, 0.3],
        [0.4, 0.5],
        [1, 1],
      ]),
    ).toThrow();
  });
});
