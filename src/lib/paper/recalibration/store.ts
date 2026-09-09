import "server-only";

import { prisma } from "@/lib/prisma";
import { RECALIBRATION_METHOD, SHRINKAGE_K } from "../config";
import {
  fitRecalibration,
  type BacktestBin,
  type Fit,
  type LiveObservation,
} from "./fit";
import { parseKnots, type ActiveRecalibration } from "./apply";

/**
 * Persistence for Probability Recalibration.
 *
 * **The only two tables this module reads are `calibration_bins` and
 * `threshold_grades`**, plus `backtest_runs` to choose which stored record to
 * fit against. Prices, settlements, recommendations, and decisions are all
 * absent by construction, and `recalibration-boundary.test.ts` proves it from
 * the source text rather than trusting this comment.
 *
 * A refit never rewrites history. Every candidate row stores the corrected
 * probability it was sized with and the `recalibrationId` that produced it, so
 * a new fit changes the next cycle and nothing that already happened.
 */

/** The stored fit currently governing a model version, or null. */
export async function activeRecalibration(
  modelVersion: string,
): Promise<ActiveRecalibration | null> {
  const row = await prisma.recalibrationFit.findFirst({
    where: { modelVersion, isActive: true },
    select: { id: true, version: true, modelVersion: true, knots: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    modelVersion: row.modelVersion,
    knots: parseKnots(row.knots),
  };
}

/**
 * The backtest run whose contract-like calibration record the fit is built
 * from: the most recent completed run for this model version that actually
 * stored `contract_like` bins.
 *
 * "Actually stored bins" is the load-bearing part. A completed run with no
 * contract-like segment cannot support a correction, and picking it would
 * produce an identity map that looks like a fit.
 */
export async function referenceBacktestRun(
  modelVersion: string,
): Promise<{ id: string; label: string | null } | null> {
  const run = await prisma.backtestRun.findFirst({
    where: {
      modelVersion,
      status: "completed",
      calibrationBins: { some: { population: "contract_like" } },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, label: true },
  });
  return run;
}

/** The ten stored contract-like bins for a run, in bin order. */
export async function backtestBinsFor(
  backtestRunId: string,
): Promise<BacktestBin[]> {
  const rows = await prisma.calibrationBin.findMany({
    where: { backtestRunId, population: "contract_like" },
    orderBy: { binIndex: "asc" },
    select: {
      binIndex: true,
      predictedMean: true,
      observedRate: true,
      thresholdObservations: true,
    },
  });
  return rows.map((row) => ({
    binIndex: row.binIndex,
    predictedMean: Number(row.predictedMean),
    observedRate: Number(row.observedRate),
    thresholdObservations: row.thresholdObservations,
  }));
}

/**
 * Live graded threshold observations for a model version.
 *
 * `contractLike` restricts to the population sizing itself trusts — the
 * volume-floor sub-population the backtest record was segmented on — so the
 * live evidence and the prior describe the same kind of prediction. Grading
 * against the official corrected line is what `ThresholdGrade.outcome` already
 * means; no settlement or price is consulted here.
 */
export async function liveObservationsFor(modelVersion: string): Promise<{
  observations: LiveObservation[];
  windowFrom: Date | null;
  windowTo: Date | null;
}> {
  const rows = await prisma.thresholdGrade.findMany({
    where: { contractLike: true, projection: { modelVersion } },
    orderBy: { gradedAt: "asc" },
    select: { statedProbability: true, outcome: true, gradedAt: true },
  });

  return {
    observations: rows.map((row) => ({
      statedProbability: Number(row.statedProbability),
      outcome: row.outcome,
    })),
    windowFrom: rows.length > 0 ? rows[0].gradedAt : null,
    windowTo: rows.length > 0 ? rows[rows.length - 1].gradedAt : null,
  };
}

export type RefitResult =
  | { status: "no_reference_backtest"; modelVersion: string }
  | { status: "unchanged"; version: number }
  | { status: "written"; version: number; liveObservationCount: number };

/**
 * Fits and stores the correction for one model version.
 *
 * Three outcomes, all of them normal:
 *
 * - **`no_reference_backtest`** — nothing is written, and the campaign will
 *   refuse to size (`no_active_recalibration`) rather than size from a raw
 *   probability. Refusing is the only alternative to a No-Go.
 * - **`unchanged`** — an identical fit over an identical live sample writes no
 *   new version. Version numbers are meant to mark real changes; a nightly job
 *   that bumped one every night would make "the active correction is versioned"
 *   true and useless.
 * - **`written`** — a new version, activated in the same transaction that
 *   deactivates its predecessor.
 */
export async function refitRecalibration(
  modelVersion: string,
  now: Date,
): Promise<RefitResult> {
  const reference = await referenceBacktestRun(modelVersion);
  if (!reference) return { status: "no_reference_backtest", modelVersion };

  const backtestBins = await backtestBinsFor(reference.id);
  const live = await liveObservationsFor(modelVersion);

  const fit = fitRecalibration({
    backtestBins,
    liveObservations: live.observations,
    shrinkageK: SHRINKAGE_K,
  });

  const current = await prisma.recalibrationFit.findFirst({
    where: { modelVersion, isActive: true },
    select: {
      id: true,
      version: true,
      knots: true,
      liveObservationCount: true,
      backtestRunId: true,
      method: true,
      shrinkageK: true,
    },
  });

  if (current && isUnchanged(current, fit, reference.id)) {
    return { status: "unchanged", version: current.version };
  }

  const highest = await prisma.recalibrationFit.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (highest?.version ?? 0) + 1;

  // One transaction: the partial unique index permits exactly one active fit
  // per model version, so deactivating and activating must not be two writes a
  // reader can land between.
  await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.recalibrationFit.update({
        where: { id: current.id },
        data: { isActive: false },
      });
    }
    await tx.recalibrationFit.create({
      data: {
        version: nextVersion,
        modelVersion,
        backtestRunId: reference.id,
        method: fit.method,
        shrinkageK: fit.shrinkageK,
        liveObservationCount: fit.liveObservationCount,
        liveWindowFrom: live.windowFrom,
        liveWindowTo: live.windowTo,
        knots: fit.knots,
        isActive: true,
        fittedAt: now,
      },
    });
  });

  return {
    status: "written",
    version: nextVersion,
    liveObservationCount: fit.liveObservationCount,
  };
}

/**
 * Whether a proposed fit says exactly what the active one already says.
 *
 * Compared on every input that could change behaviour — the knots, the live
 * sample size, the reference run, the method, and the shrinkage constant. The
 * knots are compared exactly rather than approximately: they are stored JSON
 * produced by the same deterministic code path, so a difference is a real
 * difference.
 */
export function isUnchanged(
  current: {
    knots: unknown;
    liveObservationCount: number;
    backtestRunId: string;
    method: string;
    shrinkageK: number;
  },
  proposed: Fit,
  referenceBacktestRunId: string,
): boolean {
  if (current.backtestRunId !== referenceBacktestRunId) return false;
  if (current.method !== proposed.method) return false;
  if (current.shrinkageK !== proposed.shrinkageK) return false;
  if (current.liveObservationCount !== proposed.liveObservationCount) {
    return false;
  }
  return JSON.stringify(current.knots) === JSON.stringify(proposed.knots);
}

/** Model versions with graded contract-like observations or a stored fit. */
export async function modelVersionsToRefit(): Promise<string[]> {
  const graded = await prisma.projection.findMany({
    where: { thresholdGrades: { some: { contractLike: true } } },
    distinct: ["modelVersion"],
    select: { modelVersion: true },
  });
  const fitted = await prisma.recalibrationFit.findMany({
    distinct: ["modelVersion"],
    select: { modelVersion: true },
  });
  const backtested = await prisma.backtestRun.findMany({
    where: {
      status: "completed",
      calibrationBins: { some: { population: "contract_like" } },
    },
    distinct: ["modelVersion"],
    select: { modelVersion: true },
  });
  return [
    ...new Set([
      ...graded.map((row) => row.modelVersion),
      ...fitted.map((row) => row.modelVersion),
      ...backtested.map((row) => row.modelVersion),
    ]),
  ].sort();
}

export { RECALIBRATION_METHOD };
