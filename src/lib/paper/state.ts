import "server-only";

import { prisma } from "@/lib/prisma";
import {
  bidOnHeldSide,
  drawdownBps,
  markToMarket,
  openExposureCents,
  type MarkToMarket,
  type OpenPositionMark,
} from "./bankroll";
import { evaluateBreakers, type EvaluatedBreach } from "./breakers";
import { calibrationSample } from "./calibration-window";
import { capacityCents } from "./plan";

/**
 * The campaign's current bankroll and safety state, assembled once.
 *
 * Every surface and every control that needs to know "what is true right now"
 * comes through here, so the cycle, the settlement pass, Resume, and Force
 * Override cannot disagree about whether a condition is breached. Resume in
 * particular depends on a FRESH evaluation rather than the stored rows — a
 * breach that has genuinely gone away must be clearable, and one that has not
 * must not be.
 */

export type CampaignState = {
  campaignId: string;
  startingBankrollCents: number;
  autonomyEnabled: boolean;
  killSwitchEngaged: boolean;
  highWaterMarkCents: number;
  settledBalanceCents: number;
  openExposureCents: number;
  mark: MarkToMarket;
  activeBankrollCents: number;
  drawdownBps: number | null;
  slateCapacityCents: number;
  gameCapacityCents: number;
  riskConfig: {
    id: string;
    mode: "conservative" | "moderate" | "aggressive" | "custom";
    kellyFraction: number;
    perGameCapPct: number;
    perSlateCapPct: number;
    drawdownWarnPct: number;
    drawdownHaltPct: number;
    probabilityCeiling: number;
    withdrawalCeilingMultiple: number;
  } | null;
  /** Freshly evaluated, not the stored rows. */
  currentBreaches: EvaluatedBreach[];
};

export async function readCampaignState(): Promise<CampaignState | null> {
  const campaignRow = await prisma.paperCampaign.findFirst({
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      startingBankrollCents: true,
      autonomyEnabled: true,
      highWaterMarkCents: true,
      // Kill switch is campaign-wide, held on the parent (PME-1).
      evaluationCampaign: { select: { killSwitchEngaged: true } },
    },
  });
  if (!campaignRow) return null;
  const campaign = {
    ...campaignRow,
    killSwitchEngaged: campaignRow.evaluationCampaign.killSwitchEngaged,
  };

  const configRow = await prisma.paperRiskConfig.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { effectiveFrom: "desc" },
  });

  const lastEntry = await prisma.paperLedgerEntry.findFirst({
    where: { campaignId: campaign.id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { balanceAfterCents: true },
  });
  const settledBalanceCents = lastEntry?.balanceAfterCents ?? 0;

  const openPositions = await prisma.paperPosition.findMany({
    where: { campaignId: campaign.id, status: "open" },
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
  // When the mark is unavailable the settled balance stands in for CAPACITY
  // arithmetic only, and never for the drawdown the breaker judges — that
  // reports unavailable and stops the cycle instead.
  const activeBankrollCents = mark.available
    ? mark.markCents
    : settledBalanceCents;

  const riskConfig = configRow
    ? {
        id: configRow.id,
        mode: configRow.mode,
        kellyFraction: Number(configRow.kellyFraction),
        perGameCapPct: configRow.perGameCapPct,
        perSlateCapPct: configRow.perSlateCapPct,
        drawdownWarnPct: configRow.drawdownWarnPct,
        drawdownHaltPct: configRow.drawdownHaltPct,
        probabilityCeiling: Number(configRow.probabilityCeiling),
        withdrawalCeilingMultiple: Number(configRow.withdrawalCeilingMultiple),
      }
    : null;

  const slateCapacityCents = riskConfig
    ? capacityCents(activeBankrollCents, riskConfig.perSlateCapPct)
    : 0;
  const gameCapacityCents = riskConfig
    ? capacityCents(activeBankrollCents, riskConfig.perGameCapPct)
    : 0;

  const currentBreaches = riskConfig
    ? evaluateBreakers({
        mode: riskConfig.mode,
        drawdownWarnPct: riskConfig.drawdownWarnPct,
        drawdownHaltPct: riskConfig.drawdownHaltPct,
        drawdownBps: drawdownBps(campaign.highWaterMarkCents, mark),
        openExposureCents: openExposureCents(openPositions),
        slateCapacityCents,
        calibration: await calibrationSample(),
        killSwitchEngaged: campaign.killSwitchEngaged,
      })
    : [];

  return {
    campaignId: campaign.id,
    startingBankrollCents: campaign.startingBankrollCents,
    autonomyEnabled: campaign.autonomyEnabled,
    killSwitchEngaged: campaign.killSwitchEngaged,
    highWaterMarkCents: campaign.highWaterMarkCents,
    settledBalanceCents,
    openExposureCents: openExposureCents(openPositions),
    mark,
    activeBankrollCents,
    drawdownBps: drawdownBps(campaign.highWaterMarkCents, mark),
    slateCapacityCents,
    gameCapacityCents,
    riskConfig,
    currentBreaches,
  };
}

/** The set of condition names currently breached, for Resume and Override. */
export function breachedConditions(state: CampaignState): Set<string> {
  return new Set(state.currentBreaches.map((breach) => breach.condition));
}
