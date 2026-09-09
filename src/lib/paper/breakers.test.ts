import {
  CALIBRATION_DEGRADATION_TOLERANCE,
  CALIBRATION_MARKET_TOLERANCE,
  CALIBRATION_MIN_OBSERVATIONS,
  RISK_PRESETS,
} from "./config";
import {
  calibrationVerdict,
  canResume,
  evaluateBreakers,
  halts,
  type BreakerInput,
  type CalibrationSample,
} from "./breakers";
import {
  decidePaperCycleAction,
  accountLocalDate,
  gameWindowKey,
} from "./cadence";

function sample(over: Partial<CalibrationSample> = {}): CalibrationSample {
  return {
    rollingBrier: 0.215,
    backtestBrier: 0.213,
    marketBrier: 0.221,
    modelBrierOnMarketContracts: 0.215,
    observations: 118,
    marketObservations: 118,
    ...over,
  };
}

function breakerInput(over: Partial<BreakerInput> = {}): BreakerInput {
  return {
    mode: "conservative",
    drawdownWarnPct: RISK_PRESETS.conservative.drawdownWarnPct,
    drawdownHaltPct: RISK_PRESETS.conservative.drawdownHaltPct,
    drawdownBps: 0,
    openExposureCents: 0,
    slateCapacityCents: 15_000,
    calibration: sample(),
    killSwitchEngaged: false,
    ...over,
  };
}

describe("which conditions halt", () => {
  it("halts on everything except the drawdown warning", () => {
    expect(halts("drawdown_halt")).toBe(true);
    expect(halts("calibration")).toBe(true);
    expect(halts("exposure")).toBe(true);
    expect(halts("kill_switch")).toBe(true);
    // The warning exists so 5% is visible before the hard stop. Halting on it
    // would make the warning indistinguishable from the halt.
    expect(halts("drawdown_warning")).toBe(false);
  });
});

describe("drawdown", () => {
  it("warns at 5% without halting", () => {
    const breaches = evaluateBreakers(breakerInput({ drawdownBps: 530 }));
    expect(breaches.map((b) => b.condition)).toEqual(["drawdown_warning"]);
    expect(breaches.every((b) => !halts(b.condition))).toBe(true);
  });

  it("halts at each mode's own threshold", () => {
    for (const mode of ["conservative", "moderate", "aggressive"] as const) {
      const preset = RISK_PRESETS[mode];
      const atThreshold = evaluateBreakers(
        breakerInput({
          mode,
          drawdownWarnPct: preset.drawdownWarnPct,
          drawdownHaltPct: preset.drawdownHaltPct,
          drawdownBps: preset.drawdownHaltPct * 100,
        }),
      );
      expect(atThreshold.map((b) => b.condition)).toContain("drawdown_halt");

      const justBelow = evaluateBreakers(
        breakerInput({
          mode,
          drawdownWarnPct: preset.drawdownWarnPct,
          drawdownHaltPct: preset.drawdownHaltPct,
          drawdownBps: preset.drawdownHaltPct * 100 - 1,
        }),
      );
      expect(justBelow.map((b) => b.condition)).not.toContain("drawdown_halt");
    }
  });

  it("reports the measured value and threshold together", () => {
    const breach = evaluateBreakers(breakerInput({ drawdownBps: 1_120 }))[0];
    expect(breach.measuredDisplay).toBe("11.2%");
    expect(breach.thresholdDisplay).toBe("10.0% (conservative)");
  });

  it("raises no drawdown breach when mark-to-market is unavailable", () => {
    // A check that cannot run must not silently pass OR fabricate a breach.
    // The cycle refuses to open anything in this state instead.
    const breaches = evaluateBreakers(breakerInput({ drawdownBps: null }));
    expect(breaches.map((b) => b.condition)).not.toContain("drawdown_halt");
    expect(breaches.map((b) => b.condition)).not.toContain("drawdown_warning");
  });
});

describe("exposure", () => {
  it("trips when open exposure exceeds the slate cap", () => {
    // Reachable without a new position: the cap is a percentage of CURRENT
    // active bankroll, so a falling bankroll shrinks it under what is held.
    const breaches = evaluateBreakers(
      breakerInput({ openExposureCents: 15_001, slateCapacityCents: 15_000 }),
    );
    expect(breaches.map((b) => b.condition)).toContain("exposure");
  });

  it("does not trip exactly at the cap", () => {
    const breaches = evaluateBreakers(
      breakerInput({ openExposureCents: 15_000, slateCapacityCents: 15_000 }),
    );
    expect(breaches.map((b) => b.condition)).not.toContain("exposure");
  });
});

describe("the calibration breaker", () => {
  it("does not evaluate below the minimum sample", () => {
    // Panicking on a meaningless sample and quietly passing on one are the
    // same mistake in opposite directions, and the second looks like evidence.
    const verdict = calibrationVerdict(
      sample({
        observations: CALIBRATION_MIN_OBSERVATIONS - 1,
        rollingBrier: 0.9,
      }),
    );
    expect(verdict.state).toBe("insufficient_data");
    expect(
      evaluateBreakers(
        breakerInput({
          calibration: sample({
            observations: CALIBRATION_MIN_OBSERVATIONS - 1,
            rollingBrier: 0.9,
          }),
        }),
      ).map((b) => b.condition),
    ).not.toContain("calibration");
  });

  it("does not evaluate with no rolling Brier at all", () => {
    expect(calibrationVerdict(sample({ rollingBrier: null })).state).toBe(
      "insufficient_data",
    );
  });

  it("trips on degradation beyond the tolerance", () => {
    const verdict = calibrationVerdict(
      sample({
        rollingBrier: 0.213 + CALIBRATION_DEGRADATION_TOLERANCE + 0.001,
        marketBrier: 0.9,
      }),
    );
    expect(verdict).toEqual({ state: "breached", arm: "degradation" });
  });

  it("does not trip exactly at the degradation tolerance", () => {
    expect(
      calibrationVerdict(
        sample({
          rollingBrier: 0.213 + CALIBRATION_DEGRADATION_TOLERANCE,
          marketBrier: 0.9,
        }),
      ).state,
    ).toBe("healthy");
  });

  it("trips on falling behind the market beyond the tolerance", () => {
    const verdict = calibrationVerdict(
      sample({
        backtestBrier: 0.9, // degradation arm cannot fire
        modelBrierOnMarketContracts:
          0.221 + CALIBRATION_MARKET_TOLERANCE + 0.001,
      }),
    );
    expect(verdict).toEqual({ state: "breached", arm: "market" });
  });

  it("judges the market arm on the shared contracts, not the whole window", () => {
    // The window's rolling figure is terrible and the matched one is fine.
    // Only the matched one is a like-for-like comparison against Kalshi, so
    // the arm must not fire: the gap is a sample difference, not a regression.
    expect(
      calibrationVerdict(
        sample({
          backtestBrier: 0.9,
          rollingBrier: 0.9,
          marketBrier: 0.221,
          modelBrierOnMarketContracts: 0.215,
        }),
      ).state,
    ).toBe("healthy");

    // And the reverse: the window looks healthy while the model is behind
    // Kalshi on precisely the contracts Kalshi priced. That must trip.
    expect(
      calibrationVerdict(
        sample({
          backtestBrier: 0.9,
          rollingBrier: 0.1,
          marketBrier: 0.221,
          modelBrierOnMarketContracts: 0.3,
        }),
      ),
    ).toEqual({ state: "breached", arm: "market" });
  });

  it("needs the market arm's own minimum sample independently", () => {
    // The degradation arm can still evaluate while the market subset is too
    // small — the arms are sampled separately and reported separately.
    const verdict = calibrationVerdict(
      sample({
        backtestBrier: 0.9,
        rollingBrier: 0.9,
        marketBrier: 0.1,
        modelBrierOnMarketContracts: 0.9,
        marketObservations: CALIBRATION_MIN_OBSERVATIONS - 1,
      }),
    );
    expect(verdict.state).toBe("healthy");
  });

  it("names the measured values in the breach it records", () => {
    const breach = evaluateBreakers(
      breakerInput({
        calibration: sample({ rollingBrier: 0.26, marketBrier: 0.9 }),
      }),
    ).find((b) => b.condition === "calibration");
    expect(breach?.measuredDisplay).toContain("0.260");
    expect(breach?.measuredDisplay).toContain("0.213");
    expect(breach?.thresholdDisplay).toBe("+0.030");
  });

  it("is healthy when a backtest reference is missing and the market is fine", () => {
    expect(
      calibrationVerdict(sample({ backtestBrier: null, rollingBrier: 0.2 }))
        .state,
    ).toBe("healthy");
  });
});

describe("multiple conditions", () => {
  it("returns every breached condition, not just the worst", () => {
    // The interface shows them together and Force Override requires
    // acknowledging each separately; collapsing to "the worst" would hide
    // conditions the operator is being asked to overrule.
    const breaches = evaluateBreakers(
      breakerInput({
        killSwitchEngaged: true,
        drawdownBps: 1_500,
        openExposureCents: 20_000,
        slateCapacityCents: 15_000,
        calibration: sample({ rollingBrier: 0.3 }),
      }),
    );
    expect(new Set(breaches.map((b) => b.condition))).toEqual(
      new Set(["kill_switch", "drawdown_halt", "exposure", "calibration"]),
    );
  });
});

describe("canResume", () => {
  it("permits Resume only when no halting condition remains", () => {
    expect(canResume([])).toBe(true);
    expect(canResume(["drawdown_warning"])).toBe(true);
    expect(canResume(["drawdown_halt"])).toBe(false);
    expect(canResume(["drawdown_warning", "calibration"])).toBe(false);
  });
});

describe("cadence", () => {
  const kickoff = new Date("2026-11-02T18:00:00Z");

  it("evaluates inside the window when no cycle ran recently", () => {
    expect(
      decidePaperCycleAction({
        kickoffAt: kickoff,
        lastCycleStartedAt: null,
        now: new Date("2026-11-02T14:00:00Z"),
      }),
    ).toBe("evaluate");
  });

  it("does nothing before the window opens", () => {
    expect(
      decidePaperCycleAction({
        kickoffAt: kickoff,
        lastCycleStartedAt: null,
        now: new Date("2026-11-02T11:00:00Z"),
      }),
    ).toBe("not_in_window");
  });

  it("opens the window exactly six hours out", () => {
    expect(
      decidePaperCycleAction({
        kickoffAt: kickoff,
        lastCycleStartedAt: null,
        now: new Date("2026-11-02T12:00:00Z"),
      }),
    ).toBe("evaluate");
  });

  it("reports past-cutoff distinctly from not-in-window", () => {
    // One is a game that has not come round yet; the other is a scheduled run
    // that arrived too late and must skip rather than rush. The operator needs
    // to tell them apart on the cycles list.
    expect(
      decidePaperCycleAction({
        kickoffAt: kickoff,
        lastCycleStartedAt: null,
        now: new Date("2026-11-02T17:55:00Z"),
      }),
    ).toBe("past_cutoff");
  });

  it("coalesces a cycle that ran inside the interval", () => {
    expect(
      decidePaperCycleAction({
        kickoffAt: kickoff,
        lastCycleStartedAt: new Date("2026-11-02T13:50:00Z"),
        now: new Date("2026-11-02T14:00:00Z"),
      }),
    ).toBe("coalesced");
  });

  it("evaluates again once the interval has elapsed", () => {
    expect(
      decidePaperCycleAction({
        kickoffAt: kickoff,
        lastCycleStartedAt: new Date("2026-11-02T13:20:00Z"),
        now: new Date("2026-11-02T14:00:00Z"),
      }),
    ).toBe("evaluate");
  });

  it("keys a window by the game's own kickoff, not a calendar day", () => {
    // The same reason staleness is measured per game: Thursday night, a 9:30am
    // London game, a Saturday doubleheader and Monday night are one code path.
    expect(gameWindowKey(kickoff)).toBe("2026-11-02T18:00:00.000Z");
  });

  it("resolves the account-local date in Eastern time", () => {
    // A Sunday-night game kicking off after midnight UTC is still Sunday's
    // slate to a person looking at it; UTC would split one evening's decisions
    // across two duplicate-prevention keys.
    expect(
      accountLocalDate(new Date("2026-11-03T02:30:00Z"), "America/New_York"),
    ).toBe("2026-11-02");
  });
});
