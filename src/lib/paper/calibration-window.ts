import "server-only";

import { prisma } from "@/lib/prisma";
import { CALIBRATION_WINDOW } from "./config";
import type { CalibrationSample } from "./breakers";

/**
 * The rolling calibration sample the breaker judges.
 *
 * Two arms, sampled independently:
 *
 * - **Degradation** — the trailing graded contract-like observations for the
 *   current model version, against the stored backtest Brier.
 * - **Market-relative** — the market-linked subset, against Kalshi's Brier over
 *   the same contracts.
 *
 * **The model-version filter IS the window reset.** A model change does not
 * need a stored flag or a manual clear: the window simply stops containing the
 * old model's predictions. Comparing across a change would blame a new model
 * for an old one's mistakes, or hide a regression inside better old numbers.
 *
 * The market arm is the one place a Kalshi-derived number influences autonomous
 * behaviour, and it can only ever STOP trading. Nothing here feeds a
 * probability, and the recalibration module — which does — cannot reach any of
 * these price-derived reads.
 */
export async function calibrationSample(): Promise<CalibrationSample> {
  const latest = await prisma.projection.findFirst({
    where: { thresholdGrades: { some: { contractLike: true } } },
    orderBy: { computedAt: "desc" },
    select: { modelVersion: true },
  });

  if (!latest) {
    return {
      rollingBrier: null,
      backtestBrier: null,
      marketBrier: null,
      observations: 0,
      marketObservations: 0,
    };
  }

  const grades = await prisma.thresholdGrade.findMany({
    where: {
      contractLike: true,
      projection: { modelVersion: latest.modelVersion },
    },
    orderBy: { gradedAt: "desc" },
    take: CALIBRATION_WINDOW,
    select: {
      statedProbability: true,
      outcome: true,
      thresholdSource: true,
      contractId: true,
    },
  });

  const rollingBrier =
    grades.length > 0
      ? grades.reduce((sum, grade) => {
          const stated = Number(grade.statedProbability);
          const actual = grade.outcome ? 1 : 0;
          return sum + (stated - actual) ** 2;
        }, 0) / grades.length
      : null;

  const marketLinked = grades.filter(
    (grade) => grade.thresholdSource === "market" && grade.contractId !== null,
  );

  const marketBrier = await marketBrierFor(marketLinked);

  const backtest = await prisma.backtestRun.findFirst({
    where: { modelVersion: latest.modelVersion, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { aggregates: true },
  });

  return {
    rollingBrier,
    backtestBrier: readBacktestBrier(backtest?.aggregates),
    marketBrier: marketBrier.brier,
    observations: grades.length,
    marketObservations: marketBrier.observations,
  };
}

/**
 * Kalshi's Brier over the same contracts, from the final pre-kickoff snapshot.
 *
 * The comparison is contemporaneous by construction: the market's score comes
 * from the executable price at the snapshot Sightline's own recommendation was
 * graded on, not from a price observed at some other moment.
 */
async function marketBrierFor(
  grades: Array<{ contractId: string | null; outcome: boolean }>,
): Promise<{ brier: number | null; observations: number }> {
  const contractIds = grades
    .map((grade) => grade.contractId)
    .filter((id): id is string => id !== null);
  if (contractIds.length === 0) return { brier: null, observations: 0 };

  const snapshots = await prisma.recommendationSnapshot.findMany({
    where: { contractId: { in: contractIds }, trigger: "final_pre_kickoff" },
    orderBy: { createdAt: "desc" },
    distinct: ["contractId"],
    select: { contractId: true, askCents: true, side: true },
  });
  const byContract = new Map(snapshots.map((s) => [s.contractId, s]));

  const outcomes = await prisma.outcome.findMany({
    where: { contractId: { in: contractIds } },
    select: { contractId: true, result: true },
  });
  const outcomeByContract = new Map(outcomes.map((o) => [o.contractId, o]));

  let total = 0;
  let count = 0;
  for (const contractId of new Set(contractIds)) {
    const snapshot = byContract.get(contractId);
    const outcome = outcomeByContract.get(contractId);
    if (!snapshot || snapshot.askCents === null || !snapshot.side) continue;
    // A voided market has no truth to score against and is excluded rather
    // than counted as either side.
    if (!outcome || outcome.result === "voided") continue;

    const impliedYes =
      snapshot.side === "yes"
        ? snapshot.askCents / 100
        : 1 - snapshot.askCents / 100;
    const actual = outcome.result === "yes" ? 1 : 0;
    total += (impliedYes - actual) ** 2;
    count += 1;
  }

  return { brier: count > 0 ? total / count : null, observations: count };
}

/**
 * The stored backtest Brier, read defensively.
 *
 * `aggregates` is a versioned JSON blob owned by the backtest harness. A shape
 * this module does not recognise yields null — which makes the degradation arm
 * report insufficient data rather than compare against a number it guessed at.
 */
function readBacktestBrier(aggregates: unknown): number | null {
  if (typeof aggregates !== "object" || aggregates === null) return null;
  const record = aggregates as Record<string, unknown>;

  const direct = record.brier;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;

  const calibration = record.calibration;
  if (typeof calibration === "object" && calibration !== null) {
    const nested = (calibration as Record<string, unknown>).brier;
    if (typeof nested === "number" && Number.isFinite(nested)) return nested;
  }

  const contractLike = record.contract_like ?? record.contractLike;
  if (typeof contractLike === "object" && contractLike !== null) {
    const nested = (contractLike as Record<string, unknown>).brier;
    if (typeof nested === "number" && Number.isFinite(nested)) return nested;
  }

  return null;
}
