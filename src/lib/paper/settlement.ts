import "server-only";

import type { Prisma } from "../../../generated/prisma/client";
import type { OutcomeResult } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  bidOnHeldSide,
  markToMarket,
  nextHighWaterMark,
  openExposureCents,
  settlementProceedsCents,
  withdrawalCents,
  type OpenPositionMark,
} from "./bankroll";

/**
 * Settling paper positions, advancing the high-water mark, and running the
 * withdrawal ratchet.
 *
 * Positions settle against **Kalshi's settlement**, not the official stat line.
 * The two are separate facts and may disagree; the previous pitch established
 * that settlement governs everything contract-facing while the official line
 * governs model grading, and nothing here reconciles them.
 *
 * The ledger stays append-only through every path, including supersession. When
 * Kalshi changes a settlement, the prior settlement is **reversed with
 * compensating entries** rather than edited away. A ledger that could be
 * rewritten is not a record.
 */

export type SettleResult = {
  positionsSettled: number;
  positionsVoided: number;
  settlementsSuperseded: number;
  withdrawalsMade: number;
  withdrawnCents: number;
};

type SettleablePosition = {
  id: string;
  contractId: string;
  side: "yes" | "no";
  contracts: number;
  costBasisCents: number;
  feesPaidCents: number;
  status: "open" | "settled_won" | "settled_lost" | "voided";
  settlementResult: OutcomeResult | null;
  proceedsCents: number | null;
  realizedPnlCents: number | null;
};

/**
 * Settles every position whose contract has a usable settlement, then
 * re-derives the campaign's bankroll state.
 *
 * Runs inside one transaction per campaign so the ledger, the positions, and
 * the high-water mark can never disagree about what happened.
 */
export async function settleCampaign(
  campaignId: string,
  now: Date,
): Promise<SettleResult> {
  return prisma.$transaction(async (tx) => settleInner(campaignId, now, tx));
}

async function settleInner(
  campaignId: string,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<SettleResult> {
  const campaign = await tx.paperCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      id: true,
      startingBankrollCents: true,
      highWaterMarkCents: true,
    },
  });

  const config = await tx.paperRiskConfig.findFirst({
    where: { campaignId },
    orderBy: { effectiveFrom: "desc" },
    select: { withdrawalCeilingMultiple: true },
  });
  const ceilingMultiple = config
    ? Number(config.withdrawalCeilingMultiple)
    : 1.5;

  const positions = (await tx.paperPosition.findMany({
    where: { campaignId },
    select: {
      id: true,
      contractId: true,
      side: true,
      contracts: true,
      costBasisCents: true,
      feesPaidCents: true,
      status: true,
      settlementResult: true,
      proceedsCents: true,
      realizedPnlCents: true,
    },
  })) as SettleablePosition[];

  const outcomes = await tx.outcome.findMany({
    where: { contractId: { in: positions.map((p) => p.contractId) } },
    select: { contractId: true, result: true, settledAt: true },
  });
  const outcomeByContract = new Map(outcomes.map((o) => [o.contractId, o]));

  let balance = await currentBalance(tx, campaignId);
  const result: SettleResult = {
    positionsSettled: 0,
    positionsVoided: 0,
    settlementsSuperseded: 0,
    withdrawalsMade: 0,
    withdrawnCents: 0,
  };

  for (const position of positions) {
    const outcome = outcomeByContract.get(position.contractId);
    if (!outcome) continue;

    const alreadySettled = position.status !== "open";
    if (alreadySettled && position.settlementResult === outcome.result) {
      continue; // unchanged; idempotent re-run writes nothing
    }

    if (alreadySettled) {
      // Supersession. Reverse the prior settlement with compensating entries —
      // never by editing or deleting the originals — then apply the new one.
      const priorProceeds = position.proceedsCents ?? 0;
      if (priorProceeds !== 0) {
        balance -= priorProceeds;
        await tx.paperLedgerEntry.create({
          data: {
            campaignId,
            kind:
              position.settlementResult === "voided"
                ? "void_refund"
                : "settlement_credit",
            amountCents: -priorProceeds,
            balanceAfterCents: balance,
            positionId: position.id,
            note: `settlement superseded: ${position.settlementResult} -> ${outcome.result}`,
            occurredAt: now,
          },
        });
      }
      result.settlementsSuperseded += 1;
    }

    const settled = settlementProceedsCents({
      side: position.side,
      contracts: position.contracts,
      costBasisCents: position.costBasisCents,
      feesPaidCents: position.feesPaidCents,
      result: outcome.result,
    });

    if (settled.proceedsCents !== 0) {
      balance += settled.proceedsCents;
      await tx.paperLedgerEntry.create({
        data: {
          campaignId,
          kind:
            outcome.result === "voided" ? "void_refund" : "settlement_credit",
          amountCents: settled.proceedsCents,
          balanceAfterCents: balance,
          positionId: position.id,
          occurredAt: now,
        },
      });
    }

    const status =
      outcome.result === "voided"
        ? "voided"
        : outcome.result === position.side
          ? "settled_won"
          : "settled_lost";

    await tx.paperPosition.update({
      where: { id: position.id },
      data: {
        status,
        settlementResult: outcome.result,
        proceedsCents: settled.proceedsCents,
        realizedPnlCents: settled.realizedPnlCents,
        settledAt: outcome.settledAt ?? now,
      },
    });

    if (outcome.result === "voided") result.positionsVoided += 1;
    else result.positionsSettled += 1;
  }

  // --- Mark, high-water mark, and the ratchet -----------------------------

  const stillOpen = positions.filter(
    (position) =>
      position.status === "open" && !outcomeByContract.has(position.contractId),
  );
  const marks = await markInputs(tx, stillOpen);
  const mark = markToMarket(balance, marks);

  let highWaterMark = nextHighWaterMark({
    currentCents: campaign.highWaterMarkCents,
    markCents: mark.available ? mark.markCents : null,
    withdrewCents: 0,
  });

  // The ratchet repeats: it fires again every time the account climbs back
  // through the ceiling, rather than skimming once and never again.
  let guard = 0;
  for (;;) {
    const excess = withdrawalCents(
      balance,
      campaign.startingBankrollCents,
      ceilingMultiple,
    );
    if (excess <= 0) break;
    if (++guard > 100) break; // defensive; the subtraction below always converges

    balance -= excess;
    await tx.paperLedgerEntry.create({
      data: {
        campaignId,
        kind: "withdrawal",
        amountCents: -excess,
        balanceAfterCents: balance,
        occurredAt: now,
      },
    });
    result.withdrawalsMade += 1;
    result.withdrawnCents += excess;

    // Reset the high-water mark to the POST-withdrawal active bankroll.
    // Without this, deliberately banking profit would read as a loss against
    // the pre-withdrawal peak and could trip a drawdown breaker on money the
    // account chose to remove.
    const postMark = markToMarket(balance, marks);
    highWaterMark = nextHighWaterMark({
      currentCents: highWaterMark,
      markCents: postMark.available ? postMark.markCents : balance,
      withdrewCents: excess,
    });
  }

  await tx.paperCampaign.update({
    where: { id: campaignId },
    data: { highWaterMarkCents: highWaterMark, highWaterMarkAt: now },
  });

  return result;
}

/** The running balance: the last ledger entry's, or zero for a fresh campaign. */
export async function currentBalance(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<number> {
  const last = await tx.paperLedgerEntry.findFirst({
    where: { campaignId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { balanceAfterCents: true },
  });
  return last?.balanceAfterCents ?? 0;
}

/** Open positions paired with the latest bid on the side actually held. */
async function markInputs(
  tx: Prisma.TransactionClient,
  positions: SettleablePosition[],
): Promise<OpenPositionMark[]> {
  if (positions.length === 0) return [];
  const observations = await tx.priceObservation.findMany({
    where: { contractId: { in: positions.map((p) => p.contractId) } },
    orderBy: { observedAt: "desc" },
    distinct: ["contractId"],
    select: { contractId: true, yesBidCents: true, noBidCents: true },
  });
  const byContract = new Map(observations.map((o) => [o.contractId, o]));

  return positions.map((position) => ({
    positionId: position.id,
    side: position.side,
    contracts: position.contracts,
    costBasisCents: position.costBasisCents,
    feesPaidCents: position.feesPaidCents,
    bidCentsOnHeldSide: bidOnHeldSide(
      position.side,
      byContract.get(position.contractId) ?? null,
    ),
  }));
}

export { openExposureCents };
