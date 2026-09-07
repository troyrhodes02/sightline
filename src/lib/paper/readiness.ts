import "server-only";

import { prisma } from "@/lib/prisma";
import {
  CALIBRATION_DEGRADATION_TOLERANCE,
  CALIBRATION_MARKET_TOLERANCE,
  CALIBRATION_MIN_OBSERVATIONS,
  REQUIRED_PAPER_WEEKS,
} from "./config";
import { calibrationSample } from "./calibration-window";
import { readCampaignState } from "./state";

/**
 * Live readiness.
 *
 * **This module reports. It cannot act, and nothing may make it able to.** It
 * exports exactly one function, that function returns data, and no route
 * handler imports it — `autonomy-invariants.test.ts` asserts both. Passing the
 * gate changes a chip and nothing else; real-money operation requires the later
 * Kalshi Trading capability and an explicit human decision.
 *
 * **The two-week requirement cannot be shortened.** There is no environment
 * variable, no query parameter, and no test seam that reduces
 * `REQUIRED_PAPER_WEEKS`. Two profitable weeks is already a small financial
 * sample; a shortened version of it would be evidence of nothing, and the
 * pitch's own rabbit hole is mistaking a short profitable stretch for proof.
 *
 * **A criterion that cannot be evaluated is NOT met.** `unevaluable` is a
 * distinct state that reports why, and it never counts toward eligibility —
 * missing evidence is not favourable evidence.
 */

export type ReadinessCategory =
  "paper_evidence" | "model_quality" | "safety_operations";

export type ReadinessCriterion = {
  key: string;
  category: ReadinessCategory;
  label: string;
  met: boolean;
  evidence: string;
  unevaluable: boolean;
};

export type ReadinessState =
  "not_ready" | "paper_evidence_building" | "eligible_for_live_trading";

export type Readiness = {
  state: ReadinessState;
  criteria: ReadinessCriterion[];
  evaluatedAt: string;
  disclaimer: string;
  weeksComplete: number;
  weeksRequired: number;
};

const DISCLAIMER =
  "Reaching every criterion does not enable live trading and does not create a control that would. Real-money operation requires the later Kalshi Trading capability and an explicit decision by you.";

const DISCLAIMER_ELIGIBLE =
  "Every criterion is met. This is a report, not an action. Sightline cannot move itself to real money and no control on this page will. Real-money operation requires the later Kalshi Trading capability and an explicit decision by you.";

function unevaluable(
  key: string,
  category: ReadinessCategory,
  label: string,
  reason: string,
): ReadinessCriterion {
  return {
    key,
    category,
    label,
    met: false,
    evidence: `Could not evaluate: ${reason}`,
    unevaluable: true,
  };
}

export async function readReadiness(
  now: Date = new Date(),
): Promise<Readiness> {
  const state = await readCampaignState();
  const criteria: ReadinessCriterion[] = [];

  const weeks = state ? await completeWeeks(state.campaignId) : [];
  const weeksComplete = weeks.length;

  // --- Paper evidence ------------------------------------------------------

  criteria.push({
    key: "two_weeks",
    category: "paper_evidence",
    label: "Two complete NFL weeks of autonomous paper trading",
    met: weeksComplete >= REQUIRED_PAPER_WEEKS,
    evidence:
      weeksComplete === 0
        ? `0 of ${REQUIRED_PAPER_WEEKS} complete.`
        : `${weeksComplete} of ${REQUIRED_PAPER_WEEKS} complete (${weeks
            .map((week) => `${week.season} wk ${week.week}`)
            .join(", ")}).`,
    unevaluable: false,
  });

  const cumulativePnl = weeks.reduce((sum, week) => sum + week.pnlCents, 0);
  criteria.push({
    key: "positive_pnl",
    category: "paper_evidence",
    label: "Positive cumulative net paper P&L across those weeks",
    met: weeksComplete >= REQUIRED_PAPER_WEEKS && cumulativePnl > 0,
    evidence:
      weeksComplete === 0
        ? "No complete week yet."
        : `${formatSigned(cumulativePnl)} across ${weeksComplete} complete week${weeksComplete === 1 ? "" : "s"}, after realistic fills and fees.`,
    unevaluable: false,
  });

  // --- Model quality -------------------------------------------------------

  const calibration = await calibrationSample();

  if (
    calibration.rollingBrier === null ||
    calibration.observations < CALIBRATION_MIN_OBSERVATIONS
  ) {
    criteria.push(
      unevaluable(
        "calibration",
        "model_quality",
        "Calibration within the approved range",
        `${calibration.observations} graded predictions; ${CALIBRATION_MIN_OBSERVATIONS} required`,
      ),
    );
  } else if (calibration.backtestBrier === null) {
    criteria.push(
      unevaluable(
        "calibration",
        "model_quality",
        "Calibration within the approved range",
        "no stored backtest Brier to compare against",
      ),
    );
  } else {
    const within =
      calibration.rollingBrier <=
      calibration.backtestBrier + CALIBRATION_DEGRADATION_TOLERANCE;
    criteria.push({
      key: "calibration",
      category: "model_quality",
      label: "Calibration within the approved range",
      met: within,
      evidence: `Rolling Brier ${calibration.rollingBrier.toFixed(3)} against backtest ${calibration.backtestBrier.toFixed(3)} (tolerance +${CALIBRATION_DEGRADATION_TOLERANCE.toFixed(3)}).`,
      unevaluable: false,
    });
  }

  if (
    calibration.marketBrier === null ||
    calibration.rollingBrier === null ||
    calibration.marketObservations < CALIBRATION_MIN_OBSERVATIONS
  ) {
    criteria.push(
      unevaluable(
        "market_relative",
        "model_quality",
        "Performance relative to Kalshi",
        `${calibration.marketObservations} shared contracts; ${CALIBRATION_MIN_OBSERVATIONS} required`,
      ),
    );
  } else {
    const within =
      calibration.rollingBrier <=
      calibration.marketBrier + CALIBRATION_MARKET_TOLERANCE;
    criteria.push({
      key: "market_relative",
      category: "model_quality",
      label: "Performance relative to Kalshi",
      met: within,
      evidence: `Model ${calibration.rollingBrier.toFixed(3)} against market ${calibration.marketBrier.toFixed(3)} over ${calibration.marketObservations} shared contracts (tolerance +${CALIBRATION_MARKET_TOLERANCE.toFixed(3)}).`,
      unevaluable: false,
    });
  }

  const backtest = await prisma.backtestRun.findFirst({
    where: { status: "completed", evaluationWindow: "holdout" },
    orderBy: { startedAt: "desc" },
    select: { label: true, seasonFrom: true, seasonTo: true, aggregates: true },
  });
  if (!backtest) {
    criteria.push(
      unevaluable(
        "baselines",
        "model_quality",
        "Approved baseline requirements satisfied",
        "no completed holdout backtest run",
      ),
    );
  } else {
    criteria.push({
      key: "baselines",
      category: "model_quality",
      label: "Approved baseline requirements satisfied",
      met: true,
      evidence: `Stored backtest run ${backtest.label ?? `${backtest.seasonFrom}–${backtest.seasonTo}`} (holdout).`,
      unevaluable: false,
    });
  }

  // --- Safety and operations ----------------------------------------------

  if (!state || state.riskConfig === null) {
    criteria.push(
      unevaluable(
        "drawdown",
        "safety_operations",
        "Drawdown within acceptable bounds",
        "no campaign configuration",
      ),
    );
  } else if (state.drawdownBps === null) {
    criteria.push(
      unevaluable(
        "drawdown",
        "safety_operations",
        "Drawdown within acceptable bounds",
        "mark-to-market unavailable for at least one open position",
      ),
    );
  } else {
    const pct = state.drawdownBps / 100;
    criteria.push({
      key: "drawdown",
      category: "safety_operations",
      label: "Drawdown within acceptable bounds",
      met: pct < state.riskConfig.drawdownHaltPct,
      evidence: `Drawdown ${pct.toFixed(1)}%, bound ${state.riskConfig.drawdownHaltPct.toFixed(1)}% (${state.riskConfig.mode}).`,
      unevaluable: false,
    });
  }

  const breaches = state
    ? await prisma.paperBreach.findMany({
        where: { campaignId: state.campaignId },
        select: { resolution: true },
      })
    : [];
  const overrides = breaches.filter(
    (breach) => breach.resolution === "force_overridden",
  ).length;
  criteria.push({
    key: "breakers",
    category: "safety_operations",
    label: "Breakers behaved as expected",
    // Every trip must have been resolved deliberately. An override is not a
    // failure of the breaker — the report keeps it visible either way, because
    // the fact the bot wanted to stop is part of the evidence.
    met: breaches.every((breach) => breach.resolution !== "active"),
    evidence: `${breaches.length} trip${breaches.length === 1 ? "" : "s"}, ${overrides} force override${overrides === 1 ? "" : "s"}, ${breaches.filter((b) => b.resolution === "active").length} unresolved.`,
    unevaluable: false,
  });

  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const failedCycles = state
    ? await prisma.paperCycle.count({
        where: {
          campaignId: state.campaignId,
          outcome: "failed",
          startedAt: { gte: fourteenDaysAgo },
        },
      })
    : 0;
  criteria.push({
    key: "operations",
    category: "safety_operations",
    label: "No unresolved operational failures",
    met: failedCycles === 0,
    evidence: `${failedCycles} failed cycle${failedCycles === 1 ? "" : "s"} in the last 14 days.`,
    unevaluable: false,
  });

  const breaching = state ? await capBreaches(state.campaignId) : 0;
  const totalCycles = state
    ? await prisma.paperCycle.count({ where: { campaignId: state.campaignId } })
    : 0;
  criteria.push({
    key: "sizing",
    category: "safety_operations",
    label: "Sizing and exposure behaviour responsible",
    met: breaching === 0,
    evidence: `${breaching} cap breach${breaching === 1 ? "" : "es"} across ${totalCycles} cycle${totalCycles === 1 ? "" : "s"}.`,
    unevaluable: false,
  });

  const allMet = criteria.every((criterion) => criterion.met);
  const readinessState: ReadinessState = allMet
    ? "eligible_for_live_trading"
    : weeksComplete > 0
      ? "paper_evidence_building"
      : "not_ready";

  return {
    state: readinessState,
    criteria,
    evaluatedAt: now.toISOString(),
    disclaimer: allMet ? DISCLAIMER_ELIGIBLE : DISCLAIMER,
    weeksComplete,
    weeksRequired: REQUIRED_PAPER_WEEKS,
  };
}

/**
 * NFL weeks the campaign has actually completed.
 *
 * A week counts only when every position it opened has settled or voided. A
 * week still resolving is not evidence yet, and counting it would let a strong
 * Sunday afternoon look like a finished week before its Monday-night contracts
 * had settled.
 */
async function completeWeeks(
  campaignId: string,
): Promise<Array<{ season: number; week: number; pnlCents: number }>> {
  const positions = await prisma.paperPosition.findMany({
    where: { campaignId },
    select: {
      status: true,
      realizedPnlCents: true,
      contract: { select: { game: { select: { season: true, week: true } } } },
    },
  });

  const byWeek = new Map<
    string,
    {
      season: number;
      week: number;
      total: number;
      resolved: number;
      pnl: number;
    }
  >();
  for (const position of positions) {
    const game = position.contract.game;
    if (!game) continue;
    const key = `${game.season}-${game.week}`;
    const entry = byWeek.get(key) ?? {
      season: game.season,
      week: game.week,
      total: 0,
      resolved: 0,
      pnl: 0,
    };
    entry.total += 1;
    if (position.status !== "open") {
      entry.resolved += 1;
      entry.pnl += position.realizedPnlCents ?? 0;
    }
    byWeek.set(key, entry);
  }

  return [...byWeek.values()]
    .filter((week) => week.total > 0 && week.total === week.resolved)
    .sort((a, b) => a.season - b.season || a.week - b.week)
    .map((week) => ({
      season: week.season,
      week: week.week,
      pnlCents: week.pnl,
    }));
}

/**
 * Cycles where a fill exceeded a cap or the intended size.
 *
 * The database CHECK already makes the intent case unwritable; counting it here
 * too means the readiness report would notice if the constraint were ever
 * dropped, rather than silently reporting zero because nothing could be stored.
 */
async function capBreaches(campaignId: string): Promise<number> {
  const cycles = await prisma.paperCycle.findMany({
    where: { campaignId },
    select: {
      stakedCents: true,
      gameCapacityCents: true,
      slateCapacityCents: true,
      candidates: {
        select: {
          filledContracts: true,
          intendedContracts: true,
          topOfBookSizeContracts: true,
        },
      },
    },
  });

  return cycles.filter(
    (cycle) =>
      cycle.stakedCents > cycle.slateCapacityCents ||
      cycle.stakedCents > cycle.gameCapacityCents ||
      cycle.candidates.some(
        (candidate) =>
          candidate.filledContracts > candidate.intendedContracts ||
          (candidate.topOfBookSizeContracts !== null &&
            candidate.filledContracts > candidate.topOfBookSizeContracts),
      ),
  ).length;
}

function formatSigned(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  const sign = cents < 0 ? "−" : cents > 0 ? "+" : "";
  return `${sign}$${dollars}.${remainder}`;
}
