import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  KalshiRateLimitError,
  KalshiUnavailableError,
  getMarketsByTickers,
} from "@/lib/kalshi/client";
import { sanitizeErrorMessage } from "@/lib/kalshi/sync";
import { Prisma } from "../../../generated/prisma/client";
import type { OutcomeResult } from "../../../generated/prisma/enums";
import type { KalshiMarket } from "@/lib/kalshi/types";

/**
 * Kalshi settlement ingest (Outcome Scoring & Accuracy Surface, spec §6/§10).
 *
 * Writes the `Outcome` row for settled contracts — one of the two outcome
 * truths, kept strictly separate from the official stat line. Idempotent by
 * comparison, not by error swallowing: an unchanged settlement writes
 * nothing; a changed one is superseded in place with its provenance
 * (`previousResult`, `previousRecordedAt`, `supersededCount`) retained.
 *
 * Settlement retention and model grading are separate responsibilities: an
 * outcome is written for a contract Sightline never projected or never
 * resolved. Nothing here reads projections, and the Python runtime never
 * reads this table — `outcomes` is on the import-graph blocklist.
 */

export const outcomeIngestInputSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
  })
  .strict();

export type PipelineOutcomeIngestInput = z.infer<
  typeof outcomeIngestInputSchema
>;

export type PipelineOutcomeIngestResult = {
  skipped?: "not_expected" | "coalesced";
  contractsConsidered: number;
  outcomesWritten: number; // new settlements recorded
  outcomesSuperseded: number; // settlements that changed
  unavailable: number; // tickers Kalshi could not report yet
  degraded: boolean; // Kalshi outage — designed state, 200 not 503
};

/**
 * Settlement changes are re-checked for this long after a game completes.
 * Games carry no completion timestamp, so the window is measured from each
 * game's own kickoff — the stored per-game clock, never a calendar day.
 */
export const SETTLEMENT_CHANGE_WINDOW_DAYS = 7;

/** One settlement request and one write transaction per page of contracts. */
const CONTRACTS_PER_PAGE = 100;

/**
 * Maps Kalshi's verbatim result string to Sightline's settlement vocabulary.
 *
 * Empty string is Kalshi's "not settled yet" and maps to null — counting it
 * `unavailable` rather than fabricating `voided`. Only an explicit void maps
 * to `voided`. Anything unrecognised is null too: a vocabulary surprise
 * degrades honestly instead of inventing a settlement.
 */
export function mapKalshiResult(
  rawResult: string | undefined,
): OutcomeResult | null {
  switch ((rawResult ?? "").toLowerCase()) {
    case "yes":
      return "yes";
    case "no":
      return "no";
    case "void":
    case "voided":
      return "voided";
    default:
      return null;
  }
}

function parseSettledAt(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type CandidateContract = {
  id: string;
  kalshiTicker: string;
  outcome: { result: OutcomeResult; recordedAt: Date } | null;
};

/**
 * The contracts a settlement cycle checks: those whose game completed (or
 * whose close time passed) still lacking an outcome, plus — inside the
 * settlement-change window — those that already have one, so a changed
 * settlement is caught rather than frozen at first ingest.
 *
 * Exported for the health surface, whose `outcome_ingest` expectedness must
 * mirror this exact selection: the cycle records no run row when it is empty,
 * so a signal judged by any other calendar would read `late` on every quiet
 * settled-out day.
 */
export function candidateContractWhere(now: Date): Prisma.ContractWhereInput {
  const windowStart = new Date(
    now.getTime() - SETTLEMENT_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    OR: [
      // Awaiting a first settlement. No resolution filter: settlement is
      // retained for unresolved and never-projected contracts alike.
      {
        AND: [
          { outcome: null },
          {
            OR: [
              { game: { is: { status: "completed" } } },
              { closeTime: { lt: now } },
            ],
          },
        ],
      },
      // Settlement-change window: already settled, game recent.
      {
        AND: [
          { outcome: { isNot: null } },
          {
            OR: [
              {
                game: {
                  is: { status: "completed", kickoffAt: { gt: windowStart } },
                },
              },
              // A contract that never resolved to a game still gets its
              // change window, measured from when its outcome was recorded.
              {
                AND: [
                  { game: null },
                  { outcome: { is: { recordedAt: { gt: windowStart } } } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function selectCandidateContracts(
  now: Date,
): Promise<CandidateContract[]> {
  return prisma.contract.findMany({
    where: candidateContractWhere(now),
    select: {
      id: true,
      kalshiTicker: true,
      outcome: { select: { result: true, recordedAt: true } },
    },
    orderBy: { kalshiTicker: "asc" },
  });
}

export async function runOutcomeIngest(
  input: PipelineOutcomeIngestInput,
  now: Date = new Date(),
): Promise<PipelineOutcomeIngestResult> {
  const contracts = await selectCandidateContracts(now);

  // Nothing to check — offseason or a settled-out week. Mirrors the
  // price-refresh dormancy posture: derived from stored data, never the
  // calendar, and no run row is recorded for a cycle with no work.
  if (contracts.length === 0) {
    return {
      skipped: "not_expected",
      contractsConsidered: 0,
      outcomesWritten: 0,
      outcomesSuperseded: 0,
      unavailable: 0,
      degraded: false,
    };
  }

  // One logical cycle per scheduler invocation: the unique
  // [category, invocationId] makes a re-delivered cron a structural no-op.
  let run: { id: string };
  try {
    run = await prisma.pipelineRun.create({
      data: {
        category: "outcome_ingest",
        invocationId: input.invocationId,
        scope: null,
        codeVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
        startedAt: now,
      },
      select: { id: true },
    });
  } catch (error) {
    const duplicateInvocation =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002";
    if (duplicateInvocation) {
      return {
        skipped: "coalesced",
        contractsConsidered: 0,
        outcomesWritten: 0,
        outcomesSuperseded: 0,
        unavailable: 0,
        degraded: false,
      };
    }
    throw error;
  }

  let outcomesWritten = 0;
  let outcomesSuperseded = 0;
  let unavailable = 0;
  let degraded = false;
  const notes: string[] = [];

  try {
    for (let i = 0; i < contracts.length; i += CONTRACTS_PER_PAGE) {
      const page = contracts.slice(i, i + CONTRACTS_PER_PAGE);

      let markets: KalshiMarket[];
      try {
        markets = await getMarketsByTickers(
          page.map((contract) => contract.kalshiTicker),
        );
      } catch (error) {
        if (
          error instanceof KalshiUnavailableError ||
          error instanceof KalshiRateLimitError
        ) {
          // Designed degraded mode: keep what earlier pages recorded, stop
          // asking, and report honestly. The next hourly cycle retries.
          degraded = true;
          notes.push(sanitizeErrorMessage(error));
          break;
        }
        throw error;
      }

      const marketsByTicker = new Map(
        markets.map((market) => [market.ticker, market]),
      );

      const writes: Prisma.PrismaPromise<unknown>[] = [];
      for (const contract of page) {
        const market = marketsByTicker.get(contract.kalshiTicker);
        if (!market) {
          unavailable += 1;
          continue;
        }

        const result = mapKalshiResult(market.result);
        if (result === null) {
          unavailable += 1;
          // An unexpected vocabulary entry is logged verbatim (spec §11);
          // empty string is the ordinary not-settled-yet state, not news.
          if (market.result) {
            notes.push(
              `${contract.kalshiTicker}: unmappable result ${JSON.stringify(
                market.result,
              )}`,
            );
          }
          continue;
        }

        const settledAt = parseSettledAt(market.settled_time);

        if (!contract.outcome) {
          writes.push(
            prisma.outcome.create({
              data: {
                contractId: contract.id,
                result,
                settledAt,
                recordedAt: now,
                rawResult: market.result ?? "",
              },
            }),
          );
          outcomesWritten += 1;
        } else if (contract.outcome.result !== result) {
          // A changed settlement supersedes in place, provenance retained.
          writes.push(
            prisma.outcome.update({
              where: { contractId: contract.id },
              data: {
                result,
                settledAt,
                recordedAt: now,
                rawResult: market.result ?? "",
                supersededCount: { increment: 1 },
                previousResult: contract.outcome.result,
                previousRecordedAt: contract.outcome.recordedAt,
              },
            }),
          );
          outcomesSuperseded += 1;
        }
        // Same result: no write. Idempotence is comparison, not error
        // handling — re-running against unchanged settlements is a no-op.
      }

      if (writes.length > 0) {
        await prisma.$transaction(writes);
      }
    }

    // A degraded cycle is recorded as failed so health's last-success only
    // ever advances on a complete one; the HTTP answer stays a designed 200.
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: degraded ? "failed" : "succeeded",
        errorMessage:
          notes.length > 0 ? notes.join(" | ").slice(0, 2000) : null,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    // Unexpected failure: mark the run before propagating, so it never
    // lingers as `running` until the timeout reaper reclassifies it.
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: sanitizeErrorMessage(error),
        finishedAt: new Date(),
      },
    });
    throw error;
  }

  return {
    contractsConsidered: contracts.length,
    outcomesWritten,
    outcomesSuperseded,
    unavailable,
    degraded,
  };
}
