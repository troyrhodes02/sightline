import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  modelVersionsToRefit,
  refitRecalibration,
  type RefitResult,
} from "@/lib/paper/recalibration/store";

/**
 * The nightly recalibration refit.
 *
 * Runs after grading, because grading is what produces the live evidence this
 * fits against. It is a TypeScript job rather than a Python one for a reason
 * that is structural rather than stylistic: the Python runtime is barred from
 * every price- and account-derived table, and while the fit itself touches
 * none of them, the recalibration record sits beside the paper-trading tables
 * and is read by the sizing path. Keeping it on this side of the seam means
 * the modelling runtime never acquires a reason to know a bankroll exists.
 *
 * Idempotent twice over: a re-delivered invocation is a structural no-op on
 * `[category, invocationId]`, and a fit whose knots and live sample are
 * unchanged writes no new version even when the job does run.
 */

export const recalibrationFitInputSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
  })
  .strict();

export type PipelineRecalibrationFitInput = z.infer<
  typeof recalibrationFitInputSchema
>;

export type PipelineRecalibrationFitResult = {
  skipped?: "not_expected" | "coalesced";
  modelVersionsConsidered: number;
  fitsWritten: number;
  fitsUnchanged: number;
  /** Model versions with no usable stored backtest calibration record. */
  withoutReference: number;
  results: Array<{ modelVersion: string; status: RefitResult["status"] }>;
};

export async function runRecalibrationFit(
  input: PipelineRecalibrationFitInput,
  now: Date = new Date(),
): Promise<PipelineRecalibrationFitResult> {
  const modelVersions = await modelVersionsToRefit();

  // Nothing to fit is dormancy, not failure — and, exactly as with price
  // refresh, it is derived from stored state rather than from the calendar. No
  // graded observations and no stored backtest means no run row: an empty row
  // every night would be noise, not history.
  if (modelVersions.length === 0) {
    return {
      skipped: "not_expected",
      modelVersionsConsidered: 0,
      fitsWritten: 0,
      fitsUnchanged: 0,
      withoutReference: 0,
      results: [],
    };
  }

  let run;
  try {
    run = await prisma.pipelineRun.create({
      data: {
        category: "recalibration_fit",
        status: "running",
        invocationId: input.invocationId,
        scope: null,
        codeVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
        startedAt: now,
      },
      select: { id: true },
    });
  } catch (error) {
    const isDuplicate =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
    if (!isDuplicate) throw error;
    // The unique index IS the idempotency mechanism. A duplicate delivery does
    // no work rather than racing the original to write a second version.
    return {
      skipped: "coalesced",
      modelVersionsConsidered: modelVersions.length,
      fitsWritten: 0,
      fitsUnchanged: 0,
      withoutReference: 0,
      results: [],
    };
  }

  const results: PipelineRecalibrationFitResult["results"] = [];
  let fitsWritten = 0;
  let fitsUnchanged = 0;
  let withoutReference = 0;
  let failed = false;

  for (const modelVersion of modelVersions) {
    try {
      const result = await refitRecalibration(modelVersion, now);
      results.push({ modelVersion, status: result.status });
      if (result.status === "written") fitsWritten += 1;
      else if (result.status === "unchanged") fitsUnchanged += 1;
      else withoutReference += 1;
    } catch {
      // One model version failing must not lose the fits that succeeded. The
      // run is marked failed so `/health` reports the last SUCCESSFUL fit
      // honestly, and the versions that did fit keep their new rows.
      failed = true;
      results.push({ modelVersion, status: "no_reference_backtest" });
    }
  }

  await prisma.pipelineRun.update({
    where: { id: run.id },
    data: {
      status: failed ? "failed" : "succeeded",
      finishedAt: new Date(),
      errorMessage: failed
        ? "one or more model versions could not be refitted"
        : null,
    },
  });

  return {
    modelVersionsConsidered: modelVersions.length,
    fitsWritten,
    fitsUnchanged,
    withoutReference,
    results,
  };
}
