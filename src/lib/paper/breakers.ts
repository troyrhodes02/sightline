import type {
  BreachCondition,
  RiskMode,
} from "../../../generated/prisma/enums";
import {
  CALIBRATION_DEGRADATION_TOLERANCE,
  CALIBRATION_MARKET_TOLERANCE,
  CALIBRATION_MIN_OBSERVATIONS,
} from "./config";

/**
 * Circuit breakers — pure evaluation.
 *
 * A breaker's job is to stop the bot creating new positions. It is deliberately
 * not empowered to do anything else: it settles nothing, closes nothing, and
 * deletes nothing. Open positions continue to settle normally while halted,
 * because a safety stop is a statement about future risk, not a reason to
 * liquidate at whatever the book happens to say.
 *
 * `drawdown_warning` is the one condition that does not halt. It exists so the
 * 5% level is visible before the mode-dependent hard stop arrives, and treating
 * it as halting would make the warning indistinguishable from the halt.
 */

export const HALTING_CONDITIONS: ReadonlySet<BreachCondition> = new Set([
  "drawdown_halt",
  "calibration",
  "exposure",
  "kill_switch",
]);

export function halts(condition: BreachCondition): boolean {
  return HALTING_CONDITIONS.has(condition);
}

export type EvaluatedBreach = {
  condition: BreachCondition;
  measuredValue: number;
  measuredDisplay: string;
  thresholdValue: number;
  thresholdDisplay: string;
};

export type CalibrationSample = {
  /** Rolling Brier over the trailing window, or null below the minimum. */
  rollingBrier: number | null;
  /** Stored backtest Brier for the same model version, or null. */
  backtestBrier: number | null;
  /** Kalshi's Brier over the same contracts and window, or null. */
  marketBrier: number | null;
  /** Graded observations backing `rollingBrier`. */
  observations: number;
  /** Graded observations backing the market comparison. */
  marketObservations: number;
};

export type BreakerInput = {
  mode: RiskMode;
  drawdownWarnPct: number;
  drawdownHaltPct: number;
  /** Null when mark-to-market is unavailable. */
  drawdownBps: number | null;
  openExposureCents: number;
  slateCapacityCents: number;
  calibration: CalibrationSample;
  killSwitchEngaged: boolean;
};

/**
 * Every condition currently breached.
 *
 * Multiple conditions can be breached at once and all of them are returned —
 * the interface shows them together, and Force Override requires acknowledging
 * each one separately. Collapsing them to "the worst" would hide conditions the
 * operator is being asked to overrule.
 */
export function evaluateBreakers(input: BreakerInput): EvaluatedBreach[] {
  const breaches: EvaluatedBreach[] = [];

  if (input.killSwitchEngaged) {
    breaches.push({
      condition: "kill_switch",
      measuredValue: 1,
      measuredDisplay: "engaged",
      thresholdValue: 0,
      thresholdDisplay: "not engaged",
    });
  }

  // Drawdown. `null` means mark-to-market could not be computed, and a check
  // that cannot run must not silently pass: the cycle refuses to open anything
  // in that case (see `planCycle`), so this returns no drawdown breach rather
  // than a fabricated one.
  if (input.drawdownBps !== null) {
    const pct = input.drawdownBps / 100;
    if (pct >= input.drawdownHaltPct) {
      breaches.push({
        condition: "drawdown_halt",
        measuredValue: pct,
        measuredDisplay: `${pct.toFixed(1)}%`,
        thresholdValue: input.drawdownHaltPct,
        thresholdDisplay: `${input.drawdownHaltPct.toFixed(1)}% (${input.mode})`,
      });
    } else if (pct >= input.drawdownWarnPct) {
      breaches.push({
        condition: "drawdown_warning",
        measuredValue: pct,
        measuredDisplay: `${pct.toFixed(1)}%`,
        thresholdValue: input.drawdownWarnPct,
        thresholdDisplay: `${input.drawdownWarnPct.toFixed(1)}%`,
      });
    }
  }

  // Exposure beyond the per-slate cap. Because the cap is a percentage of
  // CURRENT active bankroll, this can trip without a new position being opened
  // — a falling bankroll shrinks the cap under the exposure already held.
  if (
    input.slateCapacityCents > 0 &&
    input.openExposureCents > input.slateCapacityCents
  ) {
    breaches.push({
      condition: "exposure",
      measuredValue: input.openExposureCents,
      measuredDisplay: formatCents(input.openExposureCents),
      thresholdValue: input.slateCapacityCents,
      thresholdDisplay: formatCents(input.slateCapacityCents),
    });
  }

  const calibration = evaluateCalibration(input.calibration);
  if (calibration) breaches.push(calibration);

  return breaches;
}

export type CalibrationVerdict =
  | { state: "insufficient_data"; observations: number; required: number }
  | { state: "healthy" }
  | { state: "breached"; arm: "degradation" | "market" };

/**
 * The calibration breaker's two arms, evaluated independently.
 *
 * Each arm needs its own minimum sample. Below it the arm **states that
 * insufficient data exists and does not evaluate** — it neither trips nor
 * passes. Panicking on a statistically meaningless sample and quietly passing
 * on one are the same mistake in opposite directions, and the second is worse
 * because it looks like evidence.
 *
 * The market arm is the one place a Kalshi-derived number influences autonomous
 * behaviour. It does so as a safety check that can only STOP trading — never as
 * an input to a probability, and never inside the recalibration that produces
 * one.
 */
export function calibrationVerdict(
  sample: CalibrationSample,
): CalibrationVerdict {
  if (
    sample.rollingBrier === null ||
    sample.observations < CALIBRATION_MIN_OBSERVATIONS
  ) {
    return {
      state: "insufficient_data",
      observations: sample.observations,
      required: CALIBRATION_MIN_OBSERVATIONS,
    };
  }

  if (
    sample.backtestBrier !== null &&
    sample.rollingBrier >
      sample.backtestBrier + CALIBRATION_DEGRADATION_TOLERANCE
  ) {
    return { state: "breached", arm: "degradation" };
  }

  if (
    sample.marketBrier !== null &&
    sample.marketObservations >= CALIBRATION_MIN_OBSERVATIONS &&
    sample.rollingBrier > sample.marketBrier + CALIBRATION_MARKET_TOLERANCE
  ) {
    return { state: "breached", arm: "market" };
  }

  return { state: "healthy" };
}

function evaluateCalibration(
  sample: CalibrationSample,
): EvaluatedBreach | null {
  const verdict = calibrationVerdict(sample);
  if (verdict.state !== "breached") return null;

  const rolling = sample.rollingBrier as number;
  if (verdict.arm === "degradation") {
    const backtest = sample.backtestBrier as number;
    return {
      condition: "calibration",
      measuredValue: rolling - backtest,
      measuredDisplay:
        `${rolling.toFixed(3)} rolling against ${backtest.toFixed(3)} backtest ` +
        `(+${(rolling - backtest).toFixed(3)} over ${sample.observations} graded predictions)`,
      thresholdValue: CALIBRATION_DEGRADATION_TOLERANCE,
      thresholdDisplay: `+${CALIBRATION_DEGRADATION_TOLERANCE.toFixed(3)}`,
    };
  }

  const market = sample.marketBrier as number;
  return {
    condition: "calibration",
    measuredValue: rolling - market,
    measuredDisplay:
      `${rolling.toFixed(3)} model against ${market.toFixed(3)} market ` +
      `(+${(rolling - market).toFixed(3)} over ${sample.marketObservations} shared contracts)`,
    thresholdValue: CALIBRATION_MARKET_TOLERANCE,
    thresholdDisplay: `+${CALIBRATION_MARKET_TOLERANCE.toFixed(3)}`,
  };
}

/**
 * Whether an ordinary Resume is permitted.
 *
 * Resume is for a condition that has CLEARED. While anything is still breached
 * the operator must use Force Override instead, which records that the bot
 * wanted to stop and was overruled. Allowing Resume to paper over a live breach
 * would erase exactly the fact the audit trail exists to keep.
 */
export function canResume(activeBreaches: BreachCondition[]): boolean {
  return activeBreaches.filter(halts).length === 0;
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
