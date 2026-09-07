import {
  CALIBRATION_DEGRADATION_TOLERANCE,
  CALIBRATION_MARKET_TOLERANCE,
  CALIBRATION_MIN_OBSERVATIONS,
  CALIBRATION_WINDOW,
  CUSTOM_CAP_MAX_PCT,
  CUSTOM_CAP_MIN_PCT,
  CUSTOM_KELLY_MAX,
  DEFAULT_RISK_MODE,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_WITHDRAWAL_CEILING_MULTIPLE,
  EXECUTION_WINDOW_HOURS,
  KELLY_WARNING_THRESHOLD,
  MAX_ALLOCATION_PASSES,
  PRE_KICKOFF_CUTOFF_MINUTES,
  PROBABILITY_CEILING,
  REQUIRED_PAPER_WEEKS,
  RISK_PRESETS,
  SHRINKAGE_K,
  presetFor,
} from "./config";

const ORDERED = ["conservative", "moderate", "aggressive"] as const;

describe("risk presets", () => {
  it("orders conservative < moderate < aggressive on every risk dimension", () => {
    // A product rule, not a coincidence. The pitch states the progression is
    // deliberately intuitive; without this test an edit could invert it and
    // nothing else in the system would notice.
    for (let i = 1; i < ORDERED.length; i += 1) {
      const lower = RISK_PRESETS[ORDERED[i - 1]];
      const higher = RISK_PRESETS[ORDERED[i]];
      expect(higher.kellyFraction).toBeGreaterThan(lower.kellyFraction);
      expect(higher.perGameCapPct).toBeGreaterThan(lower.perGameCapPct);
      expect(higher.perSlateCapPct).toBeGreaterThan(lower.perSlateCapPct);
      expect(higher.drawdownHaltPct).toBeGreaterThan(lower.drawdownHaltPct);
    }
  });

  it("carries the approved numeric defaults", () => {
    expect(RISK_PRESETS.conservative).toEqual({
      kellyFraction: 0.25,
      perGameCapPct: 5,
      perSlateCapPct: 15,
      drawdownWarnPct: 5,
      drawdownHaltPct: 10,
    });
    expect(RISK_PRESETS.moderate).toEqual({
      kellyFraction: 0.5,
      perGameCapPct: 8,
      perSlateCapPct: 25,
      drawdownWarnPct: 5,
      drawdownHaltPct: 15,
    });
    expect(RISK_PRESETS.aggressive).toEqual({
      kellyFraction: 0.75,
      perGameCapPct: 12,
      perSlateCapPct: 35,
      drawdownWarnPct: 5,
      drawdownHaltPct: 20,
    });
  });

  it("keeps the drawdown warning below every mode's halt", () => {
    // 5% warns in every mode. A warning at or above the halt would never fire.
    for (const mode of ORDERED) {
      const preset = RISK_PRESETS[mode];
      expect(preset.drawdownWarnPct).toBe(5);
      expect(preset.drawdownHaltPct).toBeGreaterThan(preset.drawdownWarnPct);
    }
  });

  it("keeps every per-slate cap at least the per-game cap", () => {
    for (const mode of ORDERED) {
      const preset = RISK_PRESETS[mode];
      expect(preset.perSlateCapPct).toBeGreaterThanOrEqual(
        preset.perGameCapPct,
      );
    }
  });

  it("keeps every preset inside the bounds Custom is held to", () => {
    for (const mode of ORDERED) {
      const preset = RISK_PRESETS[mode];
      expect(preset.kellyFraction).toBeLessThanOrEqual(CUSTOM_KELLY_MAX);
      expect(preset.perGameCapPct).toBeGreaterThanOrEqual(CUSTOM_CAP_MIN_PCT);
      expect(preset.perSlateCapPct).toBeLessThanOrEqual(CUSTOM_CAP_MAX_PCT);
    }
  });

  it("defaults a new campaign to conservative", () => {
    expect(DEFAULT_RISK_MODE).toBe("conservative");
  });

  it("resolves a preset by mode", () => {
    expect(presetFor("moderate")).toBe(RISK_PRESETS.moderate);
  });
});

describe("the probability ceiling is independent of risk mode", () => {
  it("is a single constant, not a per-mode field", () => {
    // The No-Go is explicit: Aggressive must not raise what Sightline considers
    // trustworthy. Structurally, the ceiling cannot live on a preset — so
    // assert no preset carries one.
    for (const mode of ORDERED) {
      expect(RISK_PRESETS[mode]).not.toHaveProperty("probabilityCeiling");
    }
    expect(PROBABILITY_CEILING).toBe(0.75);
  });

  it("does not coincide with the aggressive Kelly fraction by accident", () => {
    // Both happen to be 0.75 and mean entirely different things. Naming them
    // separately here documents that reading one as the other is a bug.
    expect(PROBABILITY_CEILING).toBe(KELLY_WARNING_THRESHOLD);
    expect(RISK_PRESETS.aggressive.kellyFraction).toBe(0.75);
  });
});

describe("safety constants that no mode may relax", () => {
  it("holds the ten-minute cutoff and the six-hour execution window", () => {
    expect(PRE_KICKOFF_CUTOFF_MINUTES).toBe(10);
    expect(EXECUTION_WINDOW_HOURS).toBe(6);
  });

  it("bounds reallocation so the slate cannot be chased indefinitely", () => {
    expect(MAX_ALLOCATION_PASSES).toBe(3);
  });

  it("requires two complete NFL weeks for live readiness", () => {
    expect(REQUIRED_PAPER_WEEKS).toBe(2);
  });

  it("evaluates calibration over 100 predictions with a floor of 30", () => {
    expect(CALIBRATION_WINDOW).toBe(100);
    expect(CALIBRATION_MIN_OBSERVATIONS).toBe(30);
    expect(CALIBRATION_MIN_OBSERVATIONS).toBeLessThan(CALIBRATION_WINDOW);
  });

  it("tolerates more absolute degradation than market shortfall", () => {
    expect(CALIBRATION_DEGRADATION_TOLERANCE).toBe(0.03);
    expect(CALIBRATION_MARKET_TOLERANCE).toBe(0.02);
  });

  it("shrinks live calibration evidence toward the backtest prior", () => {
    expect(SHRINKAGE_K).toBe(200);
  });
});

describe("bankroll seeds", () => {
  it("starts a campaign at $1,000 with a 1.5x working ceiling", () => {
    expect(DEFAULT_STARTING_BANKROLL_CENTS).toBe(100_000);
    expect(DEFAULT_WITHDRAWAL_CEILING_MULTIPLE).toBe(1.5);
  });

  it("keeps the ceiling above 1x so the ratchet can never withdraw capital", () => {
    expect(DEFAULT_WITHDRAWAL_CEILING_MULTIPLE).toBeGreaterThanOrEqual(1);
  });
});
