import golden from "./__fixtures__/probability-golden.json";
import { probAtLeast, stdNormalCdf } from "./probability";

type GoldenCase = {
  kind: string;
  params: Record<string, number>;
  pmf: number[] | null;
  quantiles?: Record<string, number> | null;
  threshold: number;
  expected: number;
};

describe("cross-runtime probability parity", () => {
  it("matches the Python engine on every golden case to 1e-9", () => {
    // The fixture is GENERATED from the actual Python engine — the analytic
    // families from sightline_model/distributions.py, the two empirical kinds
    // from sightline_model/simulation/core.py — not a re-derivation. If either
    // side changes, this file fails rather than the two runtimes silently
    // drifting apart.
    const cases = golden as unknown as GoldenCase[];
    expect(cases.length).toBeGreaterThan(40);

    for (const testCase of cases) {
      const actual = probAtLeast(
        {
          distributionKind: testCase.kind,
          params: testCase.params,
          pmf: testCase.pmf,
          quantiles: testCase.quantiles ?? null,
        },
        testCase.threshold,
      );
      expect(actual).not.toBeNull();
      expect(Math.abs((actual as number) - testCase.expected)).toBeLessThan(
        1e-9,
      );
    }
  });

  it("covers every distribution family, analytic and empirical", () => {
    const kinds = new Set(
      (golden as unknown as GoldenCase[]).map((c) => c.kind),
    );
    expect(kinds).toEqual(
      new Set([
        "zero_inflated_lognormal",
        "negative_binomial",
        "empirical_quantiles",
        "empirical_pmf",
      ]),
    );
  });
});

describe("probAtLeast edge behaviour", () => {
  it("a non-positive threshold is certain", () => {
    expect(
      probAtLeast(
        {
          distributionKind: "zero_inflated_lognormal",
          params: { p_zero: 0.1, mu: 4, sigma: 0.5 },
          pmf: null,
        },
        0,
      ),
    ).toBe(1);
  });

  it("an unknown distribution kind yields null, never a number", () => {
    // A future engine's projection must read as "cannot derive" rather than
    // as a confidently wrong probability.
    expect(
      probAtLeast(
        { distributionKind: "simulation-v2", params: {}, pmf: null },
        10,
      ),
    ).toBeNull();
  });

  it("malformed parameters yield null", () => {
    expect(
      probAtLeast(
        {
          distributionKind: "zero_inflated_lognormal",
          params: { p_zero: 0.1, mu: 4, sigma: 0 },
          pmf: null,
        },
        10,
      ),
    ).toBeNull();
    expect(
      probAtLeast(
        {
          distributionKind: "negative_binomial",
          params: { r: 2, p: 0.5 },
          pmf: null,
        },
        1,
      ),
    ).toBeNull();
  });
});

describe("empirical_quantiles", () => {
  const grid = {
    q01: 0,
    q05: 5,
    q10: 12,
    q25: 28,
    q50: 47,
    q75: 71,
    q90: 98,
    q95: 116,
    q99: 152,
  };
  const at = (t: number) =>
    probAtLeast(
      {
        distributionKind: "empirical_quantiles",
        params: {},
        pmf: null,
        quantiles: grid,
      },
      t,
    );

  it("clamps to 1 at or below the value floor and to the q01 mass at it", () => {
    expect(at(-10)).toBe(1); // below the grid: CDF 0 → P 1
    expect(at(0)).toBeCloseTo(1 - 0.01, 12); // exactly q01 → CDF q01
  });

  it("clamps toward 1 above the highest quantile", () => {
    expect(at(200)).toBe(0); // above q99: CDF 1 → P 0
  });

  it("interpolates monotonically decreasing between grid points", () => {
    const a = at(30) as number;
    const b = at(47) as number;
    const c = at(71) as number;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(b).toBeCloseTo(1 - 0.5, 12); // the median
  });

  it("handles a non-strictly-increasing grid by nudging to monotonicity", () => {
    const flat = {
      q01: 0,
      q05: 0,
      q10: 0,
      q25: 3,
      q50: 11,
      q75: 24,
      q90: 42,
      q95: 55,
      q99: 88,
    };
    const p = probAtLeast(
      {
        distributionKind: "empirical_quantiles",
        params: {},
        pmf: null,
        quantiles: flat,
      },
      1,
    );
    expect(p).not.toBeNull();
    expect(p as number).toBeGreaterThanOrEqual(0);
    expect(p as number).toBeLessThanOrEqual(1);
  });

  it("yields null when the grid is missing", () => {
    expect(
      probAtLeast(
        {
          distributionKind: "empirical_quantiles",
          params: {},
          pmf: null,
          quantiles: null,
        },
        10,
      ),
    ).toBeNull();
  });
});

describe("empirical_pmf", () => {
  // 0..4 plus a (5+) tail bucket.
  const pmf = [0.62, 0.24, 0.09, 0.03, 0.015, 0.005];
  const at = (t: number) =>
    probAtLeast({ distributionKind: "empirical_pmf", params: {}, pmf }, t);

  it("sums tail mass at indices >= ceil(t)", () => {
    expect(at(0.5) as number).toBeCloseTo(1 - 0.62, 12); // >= 1
    expect(at(1.5) as number).toBeCloseTo(0.09 + 0.03 + 0.015 + 0.005, 12); // >= 2
  });

  it("lets the tail bucket contribute fully to a threshold at K+1", () => {
    expect(at(4.5) as number).toBeCloseTo(0.005, 12); // >= 5 → only the tail
  });

  it("is certain for a non-positive threshold", () => {
    expect(at(-1)).toBe(1);
    expect(at(0)).toBe(1);
  });

  it("yields null when the PMF is missing", () => {
    expect(
      probAtLeast(
        { distributionKind: "empirical_pmf", params: {}, pmf: null },
        1,
      ),
    ).toBeNull();
  });
});

describe("threshold complementarity for discrete stats (RD-1)", () => {
  // For a discrete stat and an INTEGER threshold N, P(>=N) + P(<N) must be
  // exactly 1: the "exactly N" mass belongs to P(>=N) and is never dropped.
  // `probAtLeast` uses ceil(N)=N for integers, summing indices >= N; the below
  // side is 1 - that, so the point mass at N cannot vanish into a gap.
  const complementary = (
    kind: string,
    pmf: number[] | null,
    quantiles: Record<string, number> | null,
    n: number,
  ) => {
    const above = probAtLeast(
      { distributionKind: kind, params: {}, pmf, quantiles },
      n,
    ) as number;
    const below = 1 - above;
    return { above, below };
  };

  it("negative_binomial: P(>=N) + P(<N) === 1 exactly at every integer N", () => {
    // A count PMF 0..4 with a (5+) tail bucket.
    const pmf = [0.5, 0.25, 0.13, 0.07, 0.03, 0.02];
    for (let n = 0; n <= 5; n += 1) {
      const { above, below } = complementary("negative_binomial", pmf, null, n);
      expect(above + below).toBe(1);
    }
  });

  it("negative_binomial: the exact-N mass is retained in P(>=N), not lost", () => {
    const pmf = [0.5, 0.25, 0.13, 0.07, 0.03, 0.02];
    // P(>=2) − P(>=3) === P(X = 2): the point mass at the integer survives.
    const pGe2 = probAtLeast(
      { distributionKind: "negative_binomial", params: {}, pmf },
      2,
    ) as number;
    const pGe3 = probAtLeast(
      { distributionKind: "negative_binomial", params: {}, pmf },
      3,
    ) as number;
    expect(pGe2 - pGe3).toBeCloseTo(pmf[2], 12);
  });

  it("empirical_pmf: P(>=N) + P(<N) === 1 exactly at every integer N", () => {
    const pmf = [0.62, 0.24, 0.09, 0.03, 0.015, 0.005];
    for (let n = 0; n <= 5; n += 1) {
      const { above, below } = complementary("empirical_pmf", pmf, null, n);
      expect(above + below).toBe(1);
    }
  });

  it("empirical_pmf: the exact-N mass is retained in P(>=N), not lost", () => {
    const pmf = [0.62, 0.24, 0.09, 0.03, 0.015, 0.005];
    const pGe1 = probAtLeast(
      { distributionKind: "empirical_pmf", params: {}, pmf },
      1,
    ) as number;
    const pGe2 = probAtLeast(
      { distributionKind: "empirical_pmf", params: {}, pmf },
      2,
    ) as number;
    expect(pGe1 - pGe2).toBeCloseTo(pmf[1], 12);
  });

  it("holds across the golden discrete fixtures (NB + empirical-PMF)", () => {
    const cases = golden as unknown as GoldenCase[];
    const discrete = cases.filter(
      (c) => c.kind === "negative_binomial" || c.kind === "empirical_pmf",
    );
    expect(discrete.length).toBeGreaterThan(0);
    for (const testCase of discrete) {
      // Evaluate at the ceil of the fixture threshold — an integer support
      // point — where the complement must be exact regardless of the .5 line.
      const n = Math.ceil(testCase.threshold);
      const above = probAtLeast(
        {
          distributionKind: testCase.kind,
          params: testCase.params,
          pmf: testCase.pmf,
          quantiles: testCase.quantiles ?? null,
        },
        n,
      ) as number;
      expect(above + (1 - above)).toBe(1);
    }
  });
});

describe("stdNormalCdf", () => {
  it("matches known reference values to double precision", () => {
    expect(Math.abs(stdNormalCdf(0) - 0.5)).toBeLessThan(1e-15);
    expect(Math.abs(stdNormalCdf(1.959963984540054) - 0.975)).toBeLessThan(
      1e-12,
    );
    expect(Math.abs(stdNormalCdf(-1) - 0.15865525393145707)).toBeLessThan(
      1e-12,
    );
    expect(Math.abs(stdNormalCdf(3) - 0.9986501019683699)).toBeLessThan(1e-12);
  });
});
