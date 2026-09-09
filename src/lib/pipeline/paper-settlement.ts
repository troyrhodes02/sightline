import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { settleCampaign } from "@/lib/paper/settlement";
import {
  bidOnHeldSide,
  drawdownBps,
  markToMarket,
  openExposureCents,
  type OpenPositionMark,
} from "@/lib/paper/bankroll";
import { evaluateBreakers } from "@/lib/paper/breakers";
import { capacityCents } from "@/lib/paper/plan";
import { calibrationSample } from "@/lib/paper/calibration-window";

/**
 * The scheduled paper settlement pass.
 *
 * Settles open positions against stored Kalshi settlements, advances the
 * high-water mark, runs the withdrawal ratchet, and re-evaluates every breaker.
 * It contacts no external service — settlement arrives through the existing
 * outcome-ingest job, so this pass reads only what is already stored, which is
 * why it can run hourly without any rate-limit budget.
 *
 * Settling continues normally while the campaign is halted or killed. A safety
 * stop prevents NEW positions; it is not a reason to leave existing ones
 * unresolved.
 */

export const paperSettlementInputSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
  })
  .strict();

export type PipelinePaperSettlementInput = z.infer<
  typeof paperSettlementInputSchema
>;

export type PipelinePaperSettlementResult = {
  skipped?: "not_expected" | "coalesced";
  positionsSettled: number;
  positionsVoided: number;
  settlementsSuperseded: number;
  withdrawalsMade: number;
  withdrawnCents: number;
  breachesOpened: number;
  degraded: boolean;
};

export async function runPaperSettlement(
  input: PipelinePaperSettlementInput,
  now: Date = new Date(),
): Promise<PipelinePaperSettlementResult> {
  const empty: PipelinePaperSettlementResult = {
    positionsSettled: 0,
    positionsVoided: 0,
    settlementsSuperseded: 0,
    withdrawalsMade: 0,
    withdrawnCents: 0,
    breachesOpened: 0,
    degraded: false,
  };

  const campaign = await prisma.paperCampaign.findFirst({
    orderBy: { startedAt: "asc" },
    select: { id: true, highWaterMarkCents: true },
  });
  if (!campaign) return { ...empty, skipped: "not_expected" };

  // Nothing open and nothing to re-check is dormancy, derived from stored
  // state. No run row: an hourly no-op through a five-month offseason would be
  // noise, not history.
  const openCount = await prisma.paperPosition.count({
    where: { campaignId: campaign.id, status: "open" },
  });
  const activeBreachCount = await prisma.paperBreach.count({
    where: { campaignId: campaign.id, resolution: "active" },
  });
  if (openCount === 0 && activeBreachCount === 0) {
    return { ...empty, skipped: "not_expected" };
  }

  let runId: string;
  try {
    const run = await prisma.pipelineRun.create({
      data: {
        category: "paper_settlement",
        status: "running",
        invocationId: input.invocationId,
        scope: null,
        codeVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
        startedAt: now,
      },
      select: { id: true },
    });
    runId = run.id;
  } catch (error) {
    const duplicate =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
    if (!duplicate) throw error;
    return { ...empty, skipped: "coalesced" };
  }

  try {
    const settled = await settleCampaign(campaign.id, now);
    const breachesOpened = await reevaluateBreakers(campaign.id, now);

    await prisma.pipelineRun.update({
      where: { id: runId },
      data: { status: "succeeded", finishedAt: new Date() },
    });

    return { ...empty, ...settled, breachesOpened };
  } catch (error) {
    await prisma.pipelineRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "the paper settlement pass failed",
      },
    });
    throw error;
  }
}

/**
 * Re-evaluates every breaker after settlement and opens rows for newly
 * breached conditions.
 *
 * Runs here as well as at cycle time because settlement is when the bankroll
 * actually moves. A losing Sunday crosses the drawdown threshold at settlement,
 * not at the moment the positions were opened, and the operator should see the
 * halt on Sunday night rather than discovering it from an empty cycle the
 * following week.
 */
async function reevaluateBreakers(
  campaignId: string,
  now: Date,
): Promise<number> {
  const campaign = await prisma.paperCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { highWaterMarkCents: true, killSwitchEngaged: true },
  });
  const config = await prisma.paperRiskConfig.findFirst({
    where: { campaignId },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!config) return 0;

  const lastEntry = await prisma.paperLedgerEntry.findFirst({
    where: { campaignId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { balanceAfterCents: true },
  });
  const settledBalanceCents = lastEntry?.balanceAfterCents ?? 0;

  const openPositions = await prisma.paperPosition.findMany({
    where: { campaignId, status: "open" },
    select: {
      id: true,
      contractId: true,
      side: true,
      contracts: true,
      costBasisCents: true,
      feesPaidCents: true,
    },
  });
  const observations = await prisma.priceObservation.findMany({
    where: { contractId: { in: openPositions.map((p) => p.contractId) } },
    orderBy: { observedAt: "desc" },
    distinct: ["contractId"],
    select: { contractId: true, yesBidCents: true, noBidCents: true },
  });
  const byContract = new Map(observations.map((o) => [o.contractId, o]));

  const marks: OpenPositionMark[] = openPositions.map((position) => ({
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

  const mark = markToMarket(settledBalanceCents, marks);
  const activeBankrollCents = mark.available
    ? mark.markCents
    : settledBalanceCents;

  const breaches = evaluateBreakers({
    mode: config.mode,
    drawdownWarnPct: config.drawdownWarnPct,
    drawdownHaltPct: config.drawdownHaltPct,
    drawdownBps: drawdownBps(campaign.highWaterMarkCents, mark),
    openExposureCents: openExposureCents(openPositions),
    slateCapacityCents: capacityCents(
      activeBankrollCents,
      config.perSlateCapPct,
    ),
    calibration: await calibrationSample(),
    // Deliberately false, matching the cycle path. The kill switch is a
    // campaign FLAG with its own release control; `engageKillSwitch` writes no
    // breach row precisely so that `releaseKillSwitch` has nothing to leave
    // behind. Persisting one here would outlive the release — the flag clears,
    // the row stays `active`, the bot stays halted on a condition the operator
    // already lifted, and recovery needs a Resume for something nobody tripped.
    killSwitchEngaged: false,
  });

  let opened = 0;
  for (const breach of breaches) {
    const existing = await prisma.paperBreach.findFirst({
      where: { campaignId, condition: breach.condition, resolution: "active" },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.paperBreach.create({
      data: {
        campaignId,
        riskConfigId: config.id,
        condition: breach.condition,
        resolution: "active",
        measuredValue: breach.measuredValue,
        measuredDisplay: breach.measuredDisplay,
        thresholdValue: breach.thresholdValue,
        thresholdDisplay: breach.thresholdDisplay,
        trippedAt: now,
      },
    });
    opened += 1;
  }
  return opened;
}
