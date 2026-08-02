import {
  fixedBuckets,
  marketComparison,
  type MarketObservationInput,
} from "./compute";

describe("fixedBuckets", () => {
  it("always returns exactly ten fixed tenths, in order", () => {
    const buckets = fixedBuckets([]);
    expect(buckets).toHaveLength(10);
    buckets.forEach((bucket, index) => {
      expect(bucket.binIndex).toBe(index);
      expect(bucket.binLow).toBeCloseTo(index / 10, 10);
      expect(bucket.binHigh).toBeCloseTo((index + 1) / 10, 10);
    });
  });

  it("fills unpopulated buckets with null means and zero counts — null and 0 are different states", () => {
    const buckets = fixedBuckets([
      {
        binIndex: 3,
        thresholdObservations: 1200,
        projectionCount: 300,
        predictedMean: 0.35,
        observedRate: 0.34,
      },
    ]);
    expect(buckets[3].predictedMean).toBe(0.35);
    expect(buckets[3].observedRate).toBe(0.34);
    expect(buckets[4].predictedMean).toBeNull();
    expect(buckets[4].observedRate).toBeNull();
    expect(buckets[4].thresholdObservations).toBe(0);
    expect(buckets[4].projectionCount).toBe(0);
  });

  it("keeps both denominators on every bucket", () => {
    const buckets = fixedBuckets([
      {
        binIndex: 0,
        thresholdObservations: 40,
        projectionCount: 12,
        predictedMean: 0.05,
        observedRate: 0.04,
      },
    ]);
    for (const bucket of buckets) {
      expect(typeof bucket.thresholdObservations).toBe("number");
      expect(typeof bucket.projectionCount).toBe("number");
    }
    expect(buckets[0].thresholdObservations).toBe(40);
    expect(buckets[0].projectionCount).toBe(12);
  });

  it("marks the floor boundary exactly: 999 observations is provisional, 1,000 is not", () => {
    const buckets = fixedBuckets([
      {
        binIndex: 1,
        thresholdObservations: 999,
        projectionCount: 200,
        predictedMean: 0.15,
        observedRate: 0.14,
      },
      {
        binIndex: 2,
        thresholdObservations: 1000,
        projectionCount: 210,
        predictedMean: 0.25,
        observedRate: 0.26,
      },
    ]);
    expect(buckets[1].belowFloor).toBe(true);
    expect(buckets[2].belowFloor).toBe(false);
  });

  it("prefers a stored belowFloor flag over deriving one (backtest bins)", () => {
    const buckets = fixedBuckets([
      {
        binIndex: 5,
        thresholdObservations: 5000,
        projectionCount: 900,
        predictedMean: 0.55,
        observedRate: 0.56,
        belowFloor: true,
      },
    ]);
    expect(buckets[5].belowFloor).toBe(true);
  });
});

describe("marketComparison", () => {
  const observation = (
    overrides: Partial<MarketObservationInput> = {},
  ): MarketObservationInput => ({
    side: "yes",
    modelProbability: 0.6,
    askCents: 55,
    resultYes: true,
    projectionId: "p1",
    yesBidCents: 53,
    yesAskCents: 55,
    noBidCents: 45,
    noAskCents: 47,
    ...overrides,
  });

  it("reports insufficient with the running count below 30 graded observations", () => {
    const result = marketComparison(
      Array.from({ length: 29 }, (_, i) =>
        observation({ projectionId: `p${i}` }),
      ),
    );
    expect(result).toEqual({ state: "insufficient", graded: 29, required: 30 });
  });

  it("reports insufficient at zero with the honest zero count", () => {
    expect(marketComparison([])).toEqual({
      state: "insufficient",
      graded: 0,
      required: 30,
    });
  });

  it("always carries the 95% interval in the ready state", () => {
    const result = marketComparison(
      Array.from({ length: 30 }, (_, i) =>
        observation({
          projectionId: `p${i}`,
          modelProbability: 0.5 + (i % 5) * 0.02,
        }),
      ),
    );
    expect(result.state).toBe("ready");
    if (result.state !== "ready") return;
    expect(Number.isFinite(result.ci95Low)).toBe(true);
    expect(Number.isFinite(result.ci95High)).toBe(true);
    expect(result.ci95Low).toBeLessThanOrEqual(result.meanEdgePoints);
    expect(result.ci95High).toBeGreaterThanOrEqual(result.meanEdgePoints);
  });

  it("computes edge and both Brier scores on the snapshot's side", () => {
    // 30 identical yes-side observations that settled yes: model said 0.6,
    // executable ask 55¢ → edge +5 pts; model Brier (1-0.6)²; market (1-0.55)².
    const result = marketComparison(
      Array.from({ length: 30 }, (_, i) =>
        observation({ projectionId: `p${i}` }),
      ),
    );
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.meanEdgePoints).toBeCloseTo(5, 6);
    expect(result.modelBrier).toBeCloseTo(0.16, 6);
    expect(result.marketBrier).toBeCloseTo(0.2025, 6);
    // Zero variance → the interval collapses onto the mean but still exists.
    expect(result.ci95Low).toBeCloseTo(5, 6);
    expect(result.ci95High).toBeCloseTo(5, 6);
  });

  it("orients a no-side observation to the no side", () => {
    // Model P(yes)=0.3 → P(no)=0.7; no ask 65¢; settled no → outcome on side 1.
    const result = marketComparison(
      Array.from({ length: 30 }, (_, i) =>
        observation({
          projectionId: `p${i}`,
          side: "no",
          modelProbability: 0.3,
          askCents: 65,
          resultYes: false,
        }),
      ),
    );
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.meanEdgePoints).toBeCloseTo(5, 6);
    expect(result.modelBrier).toBeCloseTo(0.09, 6);
    expect(result.marketBrier).toBeCloseTo(0.1225, 6);
    // Midpoint on the no side: (45 + 47) / 2 = 46¢ → 0.7 − 0.46 = +24 pts.
    expect(result.midpointEdgePoints).toBeCloseTo(24, 6);
  });

  it("returns a null midpoint when the needed book side is unavailable — never zero", () => {
    const result = marketComparison(
      Array.from({ length: 30 }, (_, i) =>
        observation({ projectionId: `p${i}`, yesBidCents: null }),
      ),
    );
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.midpointEdgePoints).toBeNull();
  });

  it("counts both denominators: observations and distinct projections", () => {
    const result = marketComparison(
      Array.from({ length: 30 }, (_, i) =>
        observation({ projectionId: `p${i % 10}` }),
      ),
    );
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.thresholdObservations).toBe(30);
    expect(result.projectionCount).toBe(10);
  });
});
