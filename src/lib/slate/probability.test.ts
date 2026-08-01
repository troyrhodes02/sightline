import golden from "./__fixtures__/probability-golden.json";
import { probAtLeast, stdNormalCdf } from "./probability";

type GoldenCase = {
  kind: string;
  params: Record<string, number>;
  pmf: number[] | null;
  threshold: number;
  expected: number;
};

describe("cross-runtime probability parity", () => {
  it("matches the Python engine on every golden case to 1e-9", () => {
    // The fixture is GENERATED from sightline_model/distributions.py — the
    // actual engine, not a re-derivation. If either side changes, this file
    // fails rather than the two runtimes silently drifting apart.
    const cases = golden as unknown as GoldenCase[];
    expect(cases.length).toBeGreaterThan(40);

    for (const testCase of cases) {
      const actual = probAtLeast(
        {
          distributionKind: testCase.kind,
          params: testCase.params,
          pmf: testCase.pmf,
        },
        testCase.threshold,
      );
      expect(actual).not.toBeNull();
      expect(Math.abs((actual as number) - testCase.expected)).toBeLessThan(
        1e-9,
      );
    }
  });

  it("covers both distribution families", () => {
    const kinds = new Set(
      (golden as unknown as GoldenCase[]).map((c) => c.kind),
    );
    expect(kinds).toEqual(
      new Set(["zero_inflated_lognormal", "negative_binomial"]),
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
