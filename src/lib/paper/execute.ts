import "server-only";

import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { currentBalance } from "./settlement";
import type { EvaluatedBreach } from "./breakers";
import type { CyclePlan } from "./plan";

/**
 * The single writer: the one code path that turns a plan into ledger entries.
 *
 * Everything upstream of here is pure — the planner decides, this commits. That
 * split is what makes Dry Run safe by construction rather than by discipline: a
 * dry run calls the planner and never calls this, so there is no flag to forget
 * and no branch to get wrong.
 *
 * One transaction per cycle. A mid-cycle breaker trip commits the fills that
 * legitimately happened alongside the breach row and the blocked candidates —
 * **the cycle is never rolled back**. Positions created before a trip are
 * valid; erasing them because a later candidate was blocked would rewrite
 * history to make the safety stop look tidier than it was.
 *
 * Nothing here deletes a position, a fill, or a ledger entry. There is no code
 * path in this feature that does.
 */

export type ExecuteCycleInput = {
  campaignId: string;
  riskConfigId: string;
  recalibrationId: string | null;
  gameId: string;
  gameWindowKey: string;
  /** Account-local calendar date, `YYYY-MM-DD`. */
  decisionDate: string;
  invocationId: string | null;
  pipelineRunId: string | null;
  plan: CyclePlan;
  /** Breaches opened by this cycle's own evaluation, if any. */
  breaches: EvaluatedBreach[];
  /** State as it was, frozen onto the cycle row. */
  snapshot: {
    bankrollAtEvaluationCents: number;
    settledBalanceCents: number;
    openExposureCents: number;
    highWaterMarkCents: number;
    drawdownBps: number | null;
    calibrationBrier: number | null;
    calibrationMarketBrier: number | null;
    calibrationSampleSize: number | null;
  };
  startedAt: Date;
  finishedAt: Date;
  errorMessage?: string | null;
};

export type ExecuteCycleResult =
  | { status: "coalesced" }
  | {
      status: "recorded";
      cycleId: string;
      positionsOpened: number;
      positionsIncreased: number;
      stakedCents: number;
    };

/** Prisma's duplicate-key error, which is this feature's idempotency signal. */
function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function executeCycle(
  input: ExecuteCycleInput,
): Promise<ExecuteCycleResult> {
  try {
    return await prisma.$transaction(async (tx) => executeInner(input, tx));
  } catch (error) {
    // A re-delivered scheduler invocation collides on
    // (campaignId, gameId, invocationId). The unique index IS the mechanism:
    // the duplicate does no work rather than racing the original.
    if (isDuplicate(error)) return { status: "coalesced" };
    throw error;
  }
}

async function executeInner(
  input: ExecuteCycleInput,
  tx: Prisma.TransactionClient,
): Promise<ExecuteCycleResult> {
  const { plan } = input;

  const cycle = await tx.paperCycle.create({
    data: {
      campaignId: input.campaignId,
      riskConfigId: input.riskConfigId,
      recalibrationId: input.recalibrationId,
      gameId: input.gameId,
      pipelineRunId: input.pipelineRunId,
      invocationId: input.invocationId,
      outcome: plan.outcome,
      skipReason: plan.skipReason,
      candidatesEvaluated: plan.candidatesEvaluated,
      candidatesSized: plan.candidatesSized,
      candidatesFilled: plan.candidatesFilled,
      stakedCents: plan.stakedCents,
      bankrollAtEvaluationCents: input.snapshot.bankrollAtEvaluationCents,
      settledBalanceCents: input.snapshot.settledBalanceCents,
      openExposureCents: input.snapshot.openExposureCents,
      slateCapacityCents: plan.slateCapacityCents,
      gameCapacityCents: plan.gameCapacityCents,
      highWaterMarkCents: input.snapshot.highWaterMarkCents,
      drawdownBps: input.snapshot.drawdownBps,
      calibrationBrier: input.snapshot.calibrationBrier,
      calibrationMarketBrier: input.snapshot.calibrationMarketBrier,
      calibrationSampleSize: input.snapshot.calibrationSampleSize,
      allocationPasses: plan.allocationPasses,
      allocationTrace: plan.allocationTrace,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
    select: { id: true },
  });

  // Breaches this cycle detected. The partial unique index permits one active
  // breach per condition, so a condition already open is left alone rather than
  // duplicated — the operator sees one row per breached condition, which is
  // what the override flow asks them to acknowledge.
  for (const breach of input.breaches) {
    const existing = await tx.paperBreach.findFirst({
      where: {
        campaignId: input.campaignId,
        condition: breach.condition,
        resolution: "active",
      },
      select: { id: true },
    });
    if (existing) continue;
    await tx.paperBreach.create({
      data: {
        campaignId: input.campaignId,
        riskConfigId: input.riskConfigId,
        condition: breach.condition,
        resolution: "active",
        measuredValue: breach.measuredValue,
        measuredDisplay: breach.measuredDisplay,
        thresholdValue: breach.thresholdValue,
        thresholdDisplay: breach.thresholdDisplay,
        detectedByCycleId: cycle.id,
        trippedAt: input.finishedAt,
      },
    });
  }

  // The running balance is read INSIDE the transaction, not taken from the
  // snapshot. The cycle cron (*/10) and the settlement pass (:20) can overlap,
  // and settlement moves the settled balance; seeding from a snapshot read
  // before the transaction would leave `balanceAfterCents` no longer equal to
  // the cumulative sum of `amountCents` — which is the single property the
  // ledger's integrity rests on. The snapshot's copy stays on the cycle row as
  // a record of what the planner saw, which is a different question.
  let balance = await currentBalance(tx, input.campaignId);
  let positionsOpened = 0;
  let positionsIncreased = 0;

  for (const candidate of plan.candidates) {
    const candidateRow = await tx.paperCycleCandidate.create({
      data: {
        cycleId: cycle.id,
        contractId: candidate.contractId,
        projectionId: candidate.projectionId,
        // Denormalised for the Hybrid audit trail (PME-1, D6): equals the
        // projection's model version at cycle time, frozen against later
        // selection changes.
        sourceModelVersion: candidate.modelVersion,
        priceObservationId: candidate.priceObservationId,
        recalibrationId: input.recalibrationId,
        rank: candidate.rank,
        rawProbability: candidate.rawProbability,
        correctedProbability: candidate.correctedProbability,
        confidence: candidate.confidence,
        side: candidate.side,
        askCents: candidate.askCents,
        feeCents: candidate.feeCents,
        netPriceCents: candidate.netPriceCents,
        topOfBookSizeContracts: candidate.topOfBookSizeContracts,
        kellyEdge: candidate.kellyEdge,
        kellyFractionApplied: candidate.kellyFractionApplied,
        intendedStakeCents: candidate.intendedStakeCents,
        intendedContracts: candidate.intendedContracts,
        filledContracts: candidate.filledContracts,
        filledCostCents: candidate.filledCostCents,
        filledFeeCents: candidate.filledFeeCents,
        verdict: candidate.verdict,
        boundBy: candidate.boundBy,
        boundByDetail: candidate.boundByDetail,
      },
      select: { id: true },
    });

    // Record the desired TOTAL for every candidate the planner priced, filled
    // or not. A candidate that wanted nothing this time still establishes the
    // total a retry compares against.
    if (candidate.desiredTotalContracts > 0 || candidate.filledContracts > 0) {
      await tx.paperDesiredExposure.upsert({
        where: {
          campaignId_contractId_gameWindowKey_decisionDate: {
            campaignId: input.campaignId,
            contractId: candidate.contractId,
            gameWindowKey: input.gameWindowKey,
            decisionDate: new Date(`${input.decisionDate}T00:00:00.000Z`),
          },
        },
        update: {
          desiredContracts: candidate.desiredTotalContracts,
          desiredStakeCents: candidate.desiredTotalStakeCents,
          lastCycleId: cycle.id,
        },
        create: {
          campaignId: input.campaignId,
          contractId: candidate.contractId,
          gameWindowKey: input.gameWindowKey,
          decisionDate: new Date(`${input.decisionDate}T00:00:00.000Z`),
          desiredContracts: candidate.desiredTotalContracts,
          desiredStakeCents: candidate.desiredTotalStakeCents,
          lastCycleId: cycle.id,
        },
      });
    }

    if (candidate.filledContracts === 0) continue;

    const side = candidate.side;
    if (side === null) {
      throw new Error("a filled candidate must have a side");
    }

    const existing = await tx.paperPosition.findUnique({
      where: {
        campaignId_contractId: {
          campaignId: input.campaignId,
          contractId: candidate.contractId,
        },
      },
      select: { id: true, side: true, status: true },
    });

    let positionId: string;
    if (existing === null) {
      const created = await tx.paperPosition.create({
        data: {
          campaignId: input.campaignId,
          contractId: candidate.contractId,
          riskConfigId: input.riskConfigId,
          side,
          contracts: candidate.filledContracts,
          costBasisCents: candidate.filledCostCents,
          feesPaidCents: candidate.filledFeeCents,
          intendedStakeCents: candidate.intendedStakeCents,
          // Fixed at open time, never rewritten (PME-1, D6). A filled candidate
          // always carries a projection (planCycle refuses those without one), so
          // this is non-null in practice; the fallback keeps the column honest.
          sourceModelVersion: candidate.modelVersion ?? "unknown",
          status: "open",
          openedAt: input.finishedAt,
        },
        select: { id: true },
      });
      positionId = created.id;
      positionsOpened += 1;
    } else {
      // An increment accumulates onto the existing position rather than
      // creating a second row, so "the current total position" is a single
      // number the next cycle can compare against.
      if (existing.side !== side) {
        throw new Error(
          "an increment must be on the same side as the position it adds to",
        );
      }
      if (existing.status !== "open") {
        throw new Error("cannot add to a settled position");
      }
      await tx.paperPosition.update({
        where: { id: existing.id },
        data: {
          contracts: { increment: candidate.filledContracts },
          costBasisCents: { increment: candidate.filledCostCents },
          feesPaidCents: { increment: candidate.filledFeeCents },
          intendedStakeCents: { increment: candidate.intendedStakeCents },
        },
      });
      positionId = existing.id;
      positionsIncreased += 1;
    }

    await tx.paperFill.create({
      data: {
        positionId,
        cycleId: cycle.id,
        candidateId: candidateRow.id,
        contracts: candidate.filledContracts,
        priceCents: candidate.askCents as number,
        feeCents: candidate.filledFeeCents,
        costCents: candidate.filledCostCents,
        filledAt: input.finishedAt,
      },
    });

    await tx.paperCycleCandidate.update({
      where: { id: candidateRow.id },
      data: { positionId },
    });

    // Stake and fee are separate ledger entries. They are separate facts: one
    // is the position, the other is the cost of taking it, and a review that
    // could not tell them apart could not answer how much fees cost the
    // campaign.
    balance -= candidate.filledCostCents;
    await tx.paperLedgerEntry.create({
      data: {
        campaignId: input.campaignId,
        kind: "stake_debit",
        amountCents: -candidate.filledCostCents,
        balanceAfterCents: balance,
        positionId,
        cycleId: cycle.id,
        occurredAt: input.finishedAt,
      },
    });

    if (candidate.filledFeeCents > 0) {
      balance -= candidate.filledFeeCents;
      await tx.paperLedgerEntry.create({
        data: {
          campaignId: input.campaignId,
          kind: "fee_debit",
          amountCents: -candidate.filledFeeCents,
          balanceAfterCents: balance,
          positionId,
          cycleId: cycle.id,
          occurredAt: input.finishedAt,
        },
      });
    }
  }

  return {
    status: "recorded",
    cycleId: cycle.id,
    positionsOpened,
    positionsIncreased,
    stakedCents: plan.stakedCents,
  };
}
