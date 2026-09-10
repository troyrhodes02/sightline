import {
  ADJUSTMENT_NEUTRAL_BAND,
  assembleReliability,
  classifyAdjustment,
  computeRate,
  type SourceReliabilityDto,
} from "./reliability";
import { RELIABILITY_MIN_SAMPLE } from "./config";

describe("computeRate — sample gating", () => {
  it("withholds the rate below the minimum sample, keeping the count", () => {
    const r = computeRate(3, 3, RELIABILITY_MIN_SAMPLE);
    expect(r.numerator).toBe(3);
    expect(r.denominator).toBe(3);
    expect(r.rate).toBeNull(); // 3 of 3 is "not enough evidence yet", never 100%
  });

  it("reports the rate at or above the minimum sample", () => {
    const r = computeRate(46, 50, RELIABILITY_MIN_SAMPLE);
    expect(r.rate).toBeCloseTo(0.92, 5);
  });

  it("gates exactly at the minimum, not one short", () => {
    expect(computeRate(10, RELIABILITY_MIN_SAMPLE - 1).rate).toBeNull();
    expect(computeRate(10, RELIABILITY_MIN_SAMPLE).rate).not.toBeNull();
  });
});

describe("classifyAdjustment", () => {
  it("improved when the shadow's error beats the base's", () => {
    expect(classifyAdjustment(10, 6)).toBe("improved");
  });
  it("hurt when the shadow's error is worse", () => {
    expect(classifyAdjustment(6, 10)).toBe("hurt");
  });
  it("neutral when equal within the band", () => {
    expect(classifyAdjustment(8, 8, ADJUSTMENT_NEUTRAL_BAND)).toBe("neutral");
  });
});

describe("assembleReliability — two independent figures, never combined", () => {
  const dto: SourceReliabilityDto = assembleReliability(
    "espn",
    { correct: 46, verifiable: 50 },
    { improved: 19, hurt: 9, neutral: 3 }, // 31 gradable
    15,
  );

  it("reports Source Accuracy and Adjustment Accuracy on independent denominators", () => {
    expect(dto.sourceAccuracy.denominator).toBe(50);
    expect(dto.adjustmentAccuracy.denominator).toBe(31);
    expect(dto.sourceAccuracy.rate).toBeCloseTo(0.92, 5);
    expect(dto.adjustmentAccuracy.rate).toBeCloseTo(19 / 31, 5);
  });

  it("gates the two rates independently — one can show while the other is withheld", () => {
    // Source verifiable = 20 (>= 15, shows); adjustment gradable = 5 (< 15, hidden).
    const mixed = assembleReliability(
      "espn",
      { correct: 18, verifiable: 20 },
      { improved: 2, hurt: 2, neutral: 1 },
      15,
    );
    expect(mixed.sourceAccuracy.rate).not.toBeNull();
    expect(mixed.adjustmentAccuracy.rate).toBeNull();
    expect(mixed.adjustmentAccuracy.denominator).toBe(5); // count still shown
  });

  it("the breakdown sums to the adjustment denominator", () => {
    const { improved, hurt, neutral } = dto.adjustmentBreakdown;
    expect(improved + hurt + neutral).toBe(dto.adjustmentAccuracy.denominator);
  });

  it("exposes NO field that combines the two figures", () => {
    // A single blended "reliability" number is a run stop-condition. The DTO
    // must carry the two rates and nothing that sums or averages them.
    const keys = Object.keys(dto);
    expect(keys.sort()).toEqual(
      [
        "adjustmentAccuracy",
        "adjustmentBreakdown",
        "minSample",
        "source",
        "sourceAccuracy",
      ].sort(),
    );
    expect("combined" in dto).toBe(false);
    expect("overall" in dto).toBe(false);
    expect("reliability" in dto).toBe(false);
  });
});
