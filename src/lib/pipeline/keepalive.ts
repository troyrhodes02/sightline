import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { KEEPALIVE_INTERVAL_DAYS } from "@/lib/health/config";

/**
 * The keepalive self-report (RD-Q11): the monthly workflow commits its marker
 * file, then reports here so `/health` can render last-acted and
 * next-required-by without a repository dashboard.
 *
 * The row is a `PipelineRun` born terminal — the action already happened; a
 * keepalive has no running phase. The commit SHA is folded into the stored
 * `invocationId` (`{workflowRunId}:{sha}`) rather than given a column: the
 * row exists for readiness derivation, and the SHA is diagnostic detail.
 */

const FUTURE_SKEW_MS = 5 * 60 * 1000;

export const keepaliveInputSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
    commitSha: z.string().regex(/^[0-9a-f]{7,40}$/),
    actedAt: z.iso.datetime(),
  })
  .strict();

export type PipelineKeepaliveInput = z.infer<typeof keepaliveInputSchema>;

export type PipelineKeepaliveResult = {
  recorded: true;
  /** actedAt + 60 days — GitHub's actual cutoff, not the amber margin. */
  nextRequiredBy: string;
};

/** Rejects an actedAt from the future beyond clock skew. */
export function actedAtIsPlausible(actedAt: string, now: Date): boolean {
  return new Date(actedAt).getTime() <= now.getTime() + FUTURE_SKEW_MS;
}

export async function recordKeepalive(
  input: PipelineKeepaliveInput,
): Promise<PipelineKeepaliveResult> {
  const actedAt = new Date(input.actedAt);
  const invocationId = `${input.invocationId}:${input.commitSha}`;

  // Duplicate delivery of one logical action records one row (idempotent).
  await prisma.pipelineRun.upsert({
    where: {
      category_invocationId: { category: "keepalive", invocationId },
    },
    update: {},
    create: {
      category: "keepalive",
      status: "succeeded",
      invocationId,
      scope: null,
      codeVersion: input.commitSha,
      startedAt: actedAt,
      finishedAt: actedAt,
    },
  });

  const nextRequiredBy = new Date(
    actedAt.getTime() + KEEPALIVE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
  );
  return { recorded: true, nextRequiredBy: nextRequiredBy.toISOString() };
}
