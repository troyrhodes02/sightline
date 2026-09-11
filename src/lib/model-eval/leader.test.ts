import {
  BACKTEST_SAMPLE_FLOOR,
  LEADER_BRIER_MARGIN,
  LIVE_SAMPLE_FLOOR,
} from "./config";
import {
  belowFloor,
  determineLeader,
  evidenceStrength,
  recommendation,
  sampleFloor,
} from "./leader";

/**
 * The leader / recommendation layer — pure boundary tests (D1/D14/D12).
 *
 * These are the states an implementer gets wrong: the margin bar is inclusive,
 * the sample floor is checked before the margin, and a thin sample is
 * `not_enough_evidence` regardless of how large the margin looks.
 */

describe("determineLeader — sample floors (D1)", () => {
  it("live sample exactly at the floor is sufficient", () => {
    const result = determineLeader({
      record: "live",
      baselineBrier: 0.24,
      simulationBrier: 0.2, // margin 0.04, well over the bar
      sampleSize: LIVE_SAMPLE_FLOOR, // exactly 50
    });
    expect(result.leader).toBe("simulation_leads");
  });

  it("live sample one below the floor is not_enough_evidence despite a large margin", () => {
    const result = determineLeader({
      record: "live",
      baselineBrier: 0.24,
      simulationBrier: 0.2,
      sampleSize: LIVE_SAMPLE_FLOOR - 1, // 49
    });
    expect(result.leader).toBe("not_enough_evidence");
    // The margin is still reported for display; the state is what gates.
    expect(result.brierMargin).toBeCloseTo(0.04, 10);
  });

  it("backtest sample exactly at 500 is sufficient", () => {
    const result = determineLeader({
      record: "backtest",
      baselineBrier: 0.2,
      simulationBrier: 0.24,
      sampleSize: BACKTEST_SAMPLE_FLOOR, // exactly 500
    });
    expect(result.leader).toBe("baseline_leads");
  });

  it("backtest sample one below 500 is not_enough_evidence", () => {
    const result = determineLeader({
      record: "backtest",
      baselineBrier: 0.2,
      simulationBrier: 0.24,
      sampleSize: BACKTEST_SAMPLE_FLOOR - 1, // 499
    });
    expect(result.leader).toBe("not_enough_evidence");
  });
});

describe("determineLeader — margin bar (D1)", () => {
  it("margin exactly 0.01 leads (inclusive bar)", () => {
    const result = determineLeader({
      record: "live",
      baselineBrier: 0.21,
      simulationBrier: 0.2, // margin exactly 0.01
      sampleSize: 100,
    });
    expect(result.brierMargin).toBeCloseTo(LEADER_BRIER_MARGIN, 10);
    expect(result.leader).toBe("simulation_leads");
  });

  it("margin just under 0.01 is too_close_to_call", () => {
    const result = determineLeader({
      record: "live",
      baselineBrier: 0.2099,
      simulationBrier: 0.2, // margin 0.0099
      sampleSize: 100,
    });
    expect(result.leader).toBe("too_close_to_call");
  });

  it("lower Brier baseline leads when the margin clears the bar", () => {
    const result = determineLeader({
      record: "live",
      baselineBrier: 0.18,
      simulationBrier: 0.22,
      sampleSize: 100,
    });
    expect(result.leader).toBe("baseline_leads");
  });

  it("a null Brier on either side is not_enough_evidence, margin null", () => {
    const result = determineLeader({
      record: "live",
      baselineBrier: null,
      simulationBrier: 0.2,
      sampleSize: 10_000, // huge sample, but one side has no evidence
    });
    expect(result.leader).toBe("not_enough_evidence");
    expect(result.brierMargin).toBeNull();
  });
});

describe("evidence strength / belowFloor", () => {
  it("scales with the record's floor", () => {
    expect(evidenceStrength("live", 49)).toBe("limited");
    expect(evidenceStrength("live", 100)).toBe("moderate"); // 2× floor
    expect(evidenceStrength("live", 200)).toBe("strong"); // 4× floor
    expect(evidenceStrength("backtest", 499)).toBe("limited");
    expect(evidenceStrength("backtest", 1000)).toBe("moderate");
    expect(evidenceStrength("backtest", 2000)).toBe("strong");
  });

  it("belowFloor tracks the record floor", () => {
    expect(belowFloor("live", 49)).toBe(true);
    expect(belowFloor("live", 50)).toBe(false);
    expect(belowFloor("backtest", 499)).toBe(true);
    expect(belowFloor("backtest", 500)).toBe(false);
  });

  it("sampleFloor is 50 live / 500 backtest", () => {
    expect(sampleFloor("live")).toBe(50);
    expect(sampleFloor("backtest")).toBe(500);
  });
});

describe("recommendation — plain-language, no side effects (D12)", () => {
  const versions = {
    baselineModelVersion: "baseline-zil-0.1.0",
    simulationModelVersion: "simulation-mc-0.1.0",
  };

  it("recommends the leading model when evidence is not limited", () => {
    const rec = recommendation({
      leader: "simulation_leads",
      record: "live",
      brierMargin: 0.03,
      sampleSize: 200, // strong
      ...versions,
    });
    expect(rec.canRecommend).toBe(true);
    expect(rec.recommendedModelVersion).toBe("simulation-mc-0.1.0");
    expect(rec.text).toContain("Simulation Engine");
    expect(rec.text.toLowerCase()).toContain("human");
  });

  it("a leader on a limited sample is directional, not recommendable", () => {
    const rec = recommendation({
      leader: "baseline_leads",
      record: "live",
      brierMargin: 0.02,
      sampleSize: 60, // above floor but limited (< 2× floor)
      ...versions,
    });
    expect(rec.canRecommend).toBe(false);
    expect(rec.recommendedModelVersion).toBe("baseline-zil-0.1.0");
    expect(rec.text.toLowerCase()).toContain("thin");
  });

  it("too_close_to_call recommends no change", () => {
    const rec = recommendation({
      leader: "too_close_to_call",
      record: "backtest",
      brierMargin: 0.005,
      sampleSize: 5000,
      ...versions,
    });
    expect(rec.canRecommend).toBe(false);
    expect(rec.recommendedModelVersion).toBeNull();
    expect(rec.text.toLowerCase()).toContain("too close");
  });

  it("not_enough_evidence recommends accumulating both engines", () => {
    const rec = recommendation({
      leader: "not_enough_evidence",
      record: "live",
      brierMargin: null,
      sampleSize: 10,
      ...versions,
    });
    expect(rec.canRecommend).toBe(false);
    expect(rec.recommendedModelVersion).toBeNull();
    expect(rec.text.toLowerCase()).toContain("not enough");
  });

  it("returns a plain object with no methods — it cannot write config", () => {
    const rec = recommendation({
      leader: "simulation_leads",
      record: "live",
      brierMargin: 0.03,
      sampleSize: 200,
      ...versions,
    });
    // A pure DTO: keys are data only, no functions to invoke a side effect.
    for (const value of Object.values(rec)) {
      expect(typeof value).not.toBe("function");
    }
    expect(new Set(Object.keys(rec))).toEqual(
      new Set(["leader", "canRecommend", "recommendedModelVersion", "text"]),
    );
  });
});
