import { parseAccuracyScope } from "./scope";

describe("parseAccuracyScope", () => {
  it("returns the documented defaults for an empty query", () => {
    expect(parseAccuracyScope({})).toEqual({
      record: "live",
      population: "contract_like",
      statType: "all",
      season: "all",
      modelVersion: null, // resolved to "latest deployed" by the read
    });
  });

  it("accepts every recognized value", () => {
    expect(
      parseAccuracyScope({
        record: "compare",
        population: "market_linked",
        stat: "receiving_yards",
        season: "2026",
        version: "baseline-v1",
      }),
    ).toEqual({
      record: "compare",
      population: "market_linked",
      statType: "receiving_yards",
      season: 2026,
      modelVersion: "baseline-v1",
    });
  });

  it("treats version=all as the labelled combined view", () => {
    expect(parseAccuracyScope({ version: "all" }).modelVersion).toBe("all");
  });

  // The URL is user-editable input, not a form: garbage falls back to that
  // control's default silently, never an error.
  it("falls back per control on garbage params", () => {
    expect(
      parseAccuracyScope({
        record: "DROP TABLE",
        population: "everyone",
        stat: "touchdown_dances",
        season: "banana",
      }),
    ).toEqual({
      record: "live",
      population: "contract_like",
      statType: "all",
      season: "all",
      modelVersion: null,
    });
  });

  it("falls back on non-year season shapes", () => {
    expect(parseAccuracyScope({ season: "26" }).season).toBe("all");
    expect(parseAccuracyScope({ season: "20261" }).season).toBe("all");
    expect(parseAccuracyScope({ season: "-2026" }).season).toBe("all");
  });

  it("uses the first value when a param repeats", () => {
    expect(parseAccuracyScope({ record: ["backtest", "live"] }).record).toBe(
      "backtest",
    );
  });
});
