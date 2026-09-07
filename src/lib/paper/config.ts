import type { RiskMode } from "../../../generated/prisma/enums";

/**
 * Operating bounds for autonomous paper trading.
 *
 * **Deliberate constants, not environment variables.** A bound that differed
 * between environments would make the same campaign read safe in one place and
 * halted in another, and the values that a human genuinely tunes — starting
 * bankroll, the withdrawal ceiling, a Custom mode's parameters — are stored on
 * `PaperRiskConfig` and `PaperCampaign` where a change is a recorded event
 * rather than a redeploy. These are the seeds and the presets those rows start
 * from, and the fixed limits nothing may move.
 *
 * Mirrors `src/lib/health/config.ts` and `src/lib/accuracy/config.ts`.
 */

/**
 * The permitted risk envelope for one mode. `custom` has no preset — it is
 * whatever the admin entered, bounded by the validation rules and by the
 * database CHECK on `paper_risk_configs`.
 */
export type RiskPreset = {
  /** Fraction of full Kelly. Full Kelly assumes the probability is exact. */
  kellyFraction: number;
  /** Per-game exposure cap, as a percentage of CURRENT active bankroll. */
  perGameCapPct: number;
  /** Per-slate exposure cap, as a percentage of CURRENT active bankroll. */
  perSlateCapPct: number;
  /** Drawdown that warns prominently without halting. */
  drawdownWarnPct: number;
  /** Drawdown that halts new autonomous positions. */
  drawdownHaltPct: number;
};

/**
 * The three presets, and the ordering that is a product rule rather than a
 * coincidence: Conservative permits less bankroll risk than Moderate, which
 * permits less than Aggressive. `config.test.ts` asserts that ordering, so a
 * future edit cannot quietly invert it.
 *
 * Caps are percentages of **current** active bankroll, never of the original
 * starting balance — caps that did not scale would become meaningless on a
 * successful campaign and punitive on an unsuccessful one.
 */
export const RISK_PRESETS: Readonly<
  Record<Exclude<RiskMode, "custom">, RiskPreset>
> = {
  conservative: {
    kellyFraction: 0.25,
    perGameCapPct: 5,
    perSlateCapPct: 15,
    drawdownWarnPct: 5,
    drawdownHaltPct: 10,
  },
  moderate: {
    kellyFraction: 0.5,
    perGameCapPct: 8,
    perSlateCapPct: 25,
    drawdownWarnPct: 5,
    drawdownHaltPct: 15,
  },
  aggressive: {
    kellyFraction: 0.75,
    perGameCapPct: 12,
    perSlateCapPct: 35,
    drawdownWarnPct: 5,
    drawdownHaltPct: 20,
  },
};

/** Conservative is the default and the starting recommendation. */
export const DEFAULT_RISK_MODE: RiskMode = "conservative";

/**
 * The probability ceiling: no contract whose corrected probability exceeds this
 * receives a stake.
 *
 * **Independent of risk mode.** Risk mode governs how much to risk on
 * acceptable opportunities; it does not redefine which probabilities Sightline
 * considers trustworthy. Raising this requires calibration evidence that the
 * model is reliable above the current boundary, which is a human decision and a
 * separate change — not something a winning streak earns.
 */
export const PROBABILITY_CEILING = 0.75;

/**
 * Above this Kelly fraction, Custom mode shows a persistent warning. It does
 * not block: Custom exists precisely so the presets can be overridden
 * deliberately.
 */
export const KELLY_WARNING_THRESHOLD = 0.75;

/** Custom mode's admin-entered bounds. Mirrored by the database CHECK. */
export const CUSTOM_KELLY_MIN = 0;
export const CUSTOM_KELLY_MAX = 1.0;
export const CUSTOM_CAP_MIN_PCT = 1;
export const CUSTOM_CAP_MAX_PCT = 50;

/** Seed for a new campaign's starting balance. Admin-configurable thereafter. */
export const DEFAULT_STARTING_BANKROLL_CENTS = 100_000;

/**
 * Working ceiling for the simulated-withdrawal ratchet, as a multiple of the
 * starting bankroll. Above it, the excess is withdrawn to simulated withdrawn
 * profit and active bankroll returns to the ceiling — repeatedly, as the
 * account keeps growing.
 *
 * 1.5× is wide enough that ordinary variance does not trigger a withdrawal
 * every other week, and tight enough that a genuinely strong run gets tested
 * under the withdrawal-adjusted bankroll it would actually have operated on.
 */
export const DEFAULT_WITHDRAWAL_CEILING_MULTIPLE = 1.5;

/**
 * Kalshi's general trading-fee rate. Paper execution crosses the spread at the
 * ask, so it is always the taker side and the maker schedule never applies;
 * settlement carries no fee.
 */
export const KALSHI_FEE_RATE = 0.07;

/**
 * No new autonomous position inside this many minutes of kickoff.
 *
 * **Not configurable, and not weakened by any risk mode.** Aggressive means
 * accepting more controlled bankroll risk; it does not mean ignoring timing
 * safeguards. Evaluated at the moment a fill would be written, not only at
 * cycle start, so a cycle that runs long still stops.
 */
export const PRE_KICKOFF_CUTOFF_MINUTES = 10;

/**
 * A game becomes eligible for autonomous cycles this many hours before its own
 * kickoff. Matches `GAMEDAY_PRICE_WINDOW_HOURS`, so a cycle only ever runs
 * while the price cadence is already game-day and the book it reads is fresh.
 */
export const EXECUTION_WINDOW_HOURS = 6;

/** At most one cycle per game per this many minutes. Coalescing, not a cap. */
export const PAPER_CYCLE_INTERVAL_MINUTES = 30;

/**
 * How long after kickoff a counterfactual replay treats a game as finished, and
 * therefore its positions as settleable.
 *
 * Replay has no settlement timestamps to work from — it re-simulates from the
 * stored candidate rows — so it needs a rule for when cash comes back. Four
 * hours is longer than an NFL game runs, deliberately: returning the cash late
 * can only reduce what a later cycle in the same replay is able to stake, and
 * a counterfactual that stakes more than the real campaign could have is the
 * flattering direction of error.
 */
export const GAME_DURATION_ALLOWANCE_HOURS = 4;

/**
 * Allocation passes per cycle. Reassessing the slate after a partial fill is
 * valuable; chasing the same unavailable liquidity is the rabbit hole. A
 * candidate whose fill was capped by displayed size is liquidity-exhausted for
 * the remainder of the cycle and is not retried, so this bound is a backstop
 * rather than the primary termination condition.
 */
export const MAX_ALLOCATION_PASSES = 3;

/** Trailing graded predictions the calibration breaker evaluates. */
export const CALIBRATION_WINDOW = 100;

/**
 * Below this many graded observations the calibration breaker does not
 * evaluate at all: it states that insufficient data exists rather than passing
 * or failing on a sample too small to mean anything. Each arm — degradation and
 * market-relative — needs the minimum independently.
 */
export const CALIBRATION_MIN_OBSERVATIONS = 30;

/** Rolling Brier may exceed the stored backtest Brier by at most this. */
export const CALIBRATION_DEGRADATION_TOLERANCE = 0.03;

/** Rolling Brier may exceed Kalshi's rolling Brier by at most this. */
export const CALIBRATION_MARKET_TOLERANCE = 0.02;

/**
 * Live observations at which a calibration bin's live evidence carries equal
 * weight with the backtest prior: `w = n / (n + K)`.
 *
 * The first few live games are informative and nowhere near strong enough to
 * replace the historical record, which is what this number encodes.
 */
export const SHRINKAGE_K = 200;

/** The recalibration method identifier stored on every fit. */
export const RECALIBRATION_METHOD = "pava_piecewise_linear/v1";

/** Corrected probabilities are clamped into this open interval. */
export const CORRECTED_PROBABILITY_MIN = 0.001;
export const CORRECTED_PROBABILITY_MAX = 0.999;

/**
 * Complete NFL weeks of autonomous paper trading required before live
 * readiness can pass.
 *
 * **There is deliberately no way to shorten this** — no environment variable,
 * no query parameter, no test seam. Two profitable weeks is already a small
 * financial sample; a shortened version of it would be evidence of nothing.
 */
export const REQUIRED_PAPER_WEEKS = 2;

/** The account-local timezone. NFL schedules are expressed in Eastern time. */
export const ACCOUNT_TIMEZONE = "America/New_York";

/** Resolves the preset for a mode; `custom` has none by construction. */
export function presetFor(mode: Exclude<RiskMode, "custom">): RiskPreset {
  return RISK_PRESETS[mode];
}
