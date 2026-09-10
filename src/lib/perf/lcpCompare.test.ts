import {
  REQUIRED_LCP_REDUCTION_PCT,
  compareLcp,
  comparabilityReason,
  percentReduction,
  type LcpBaseline,
} from "./lcpCompare";

describe("percentReduction", () => {
  it("is positive when the current measurement is faster than the baseline", () => {
    expect(percentReduction(1000, 700)).toBeCloseTo(30, 9);
  });

  it("is zero when unchanged", () => {
    expect(percentReduction(1000, 1000)).toBe(0);
  });

  it("is negative when the current measurement regressed", () => {
    expect(percentReduction(1000, 1200)).toBeCloseTo(-20, 9);
  });

  it("rejects a non-positive baseline", () => {
    expect(() => percentReduction(0, 500)).toThrow();
    expect(() => percentReduction(-1, 500)).toThrow();
  });

  it("rejects a negative current measurement", () => {
    expect(() => percentReduction(1000, -1)).toThrow();
  });
});

describe("compareLcp", () => {
  it("passes exactly at the required bar", () => {
    const result = compareLcp(1000, 700);
    expect(result.reductionPct).toBeCloseTo(30, 9);
    expect(result.requiredPct).toBe(REQUIRED_LCP_REDUCTION_PCT);
    expect(result.passes).toBe(true);
  });

  it("passes comfortably above the bar", () => {
    expect(compareLcp(1000, 500).passes).toBe(true);
  });

  it("fails just below the bar", () => {
    const result = compareLcp(1000, 701);
    expect(result.reductionPct).toBeLessThan(30);
    expect(result.passes).toBe(false);
  });

  it("fails on a regression", () => {
    expect(compareLcp(1000, 1100).passes).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(compareLcp(1000, 900, 5).passes).toBe(true);
    expect(compareLcp(1000, 960, 5).passes).toBe(false);
  });
});

describe("comparabilityReason", () => {
  const measured: LcpBaseline = {
    measured: true,
    lcpMs: 1000,
    commit: "abc123",
  };
  const placeholder: LcpBaseline = {
    measured: false,
    lcpMs: null,
    commit: null,
  };

  it("refuses to compare against a placeholder baseline", () => {
    const { comparable, reason } = comparabilityReason(placeholder, 700);
    expect(comparable).toBe(false);
    expect(reason).toMatch(/placeholder/);
  });

  it("refuses when there is no current measurement", () => {
    const { comparable, reason } = comparabilityReason(measured, null);
    expect(comparable).toBe(false);
    expect(reason).toMatch(/no current/i);
  });

  it("is comparable when baseline is measured and a current value exists", () => {
    expect(comparabilityReason(measured, 700)).toEqual({
      comparable: true,
      reason: null,
    });
  });
});
