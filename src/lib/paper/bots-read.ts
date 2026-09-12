import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  BankrollHistoryPointDto,
  PaperBotDetailDto,
  PaperBotSummaryDto,
} from "@/lib/dto/paper-bots";
import type { PositionRowDto } from "@/lib/dto/autonomy";
import { campaignFinancials } from "./scorecards";
import { toCycleRow } from "./read";

/**
 * Paper Bot Lab reads (design doc §8).
 *
 * ALL bots — the three canonical comparison bots and every custom Lab bot — are
 * returned here uniformly, each reusing the same financial math the scorecards
 * use (`campaignFinancials`) so a bot's bankroll, P&L, drawdown, and return mean
 * the same thing everywhere. Nothing here aggregates across bots; each row stands
 * alone (paper figures are never summed).
 */

const BOT_NAME_FALLBACK: Record<string, string> = {
  baseline: "Baseline",
  simulation: "Simulation",
  hybrid: "Hybrid",
};

async function summaryFor(campaign: {
  id: string;
  label: string | null;
  portfolio: PaperBotSummaryDto["engine"];
  startingBankrollCents: number;
  highWaterMarkCents: number;
  autonomyEnabled: boolean;
  isComparison: boolean;
}): Promise<PaperBotSummaryDto> {
  const financials = await campaignFinancials({
    id: campaign.id,
    startingBankrollCents: campaign.startingBankrollCents,
    highWaterMarkCents: campaign.highWaterMarkCents,
  });
  return {
    id: campaign.id,
    name: campaign.label ?? BOT_NAME_FALLBACK[campaign.portfolio] ?? "Bot",
    engine: campaign.portfolio,
    riskMode: financials.riskMode,
    startingBankrollCents: campaign.startingBankrollCents,
    activeBankrollCents: financials.activeBankrollCents,
    netPnlCents: financials.netPnlCents,
    returnPct: financials.returnPct,
    maxDrawdownBps: financials.maxDrawdownBps,
    positionCount: financials.positionCount,
    autonomyEnabled: campaign.autonomyEnabled,
    isComparison: campaign.isComparison,
  };
}

/**
 * Every bot under an evaluation campaign — comparison first (stable engine order),
 * then custom bots oldest → newest. Each row carries its own financial figures.
 */
export async function readPaperBots(
  evaluationCampaignId: string,
): Promise<PaperBotSummaryDto[]> {
  const bots = await prisma.paperCampaign.findMany({
    where: { evaluationCampaignId },
    select: {
      id: true,
      label: true,
      portfolio: true,
      startingBankrollCents: true,
      highWaterMarkCents: true,
      autonomyEnabled: true,
      isComparison: true,
      startedAt: true,
    },
  });

  const engineOrder: Record<PaperBotSummaryDto["engine"], number> = {
    baseline: 0,
    simulation: 1,
    hybrid: 2,
  };
  const sorted = [...bots].sort((a, b) => {
    // Comparison bots first, in engine order; then custom bots by start time.
    if (a.isComparison !== b.isComparison) return a.isComparison ? -1 : 1;
    if (a.isComparison && b.isComparison) {
      return engineOrder[a.portfolio] - engineOrder[b.portfolio];
    }
    return a.startedAt.getTime() - b.startedAt.getTime();
  });

  return Promise.all(sorted.map(summaryFor));
}

/** One bot's detail: summary + bankroll history + positions + recent cycles. */
export async function readBotDetail(
  botId: string,
): Promise<PaperBotDetailDto | null> {
  const campaign = await prisma.paperCampaign.findUnique({
    where: { id: botId },
    select: {
      id: true,
      label: true,
      portfolio: true,
      startingBankrollCents: true,
      highWaterMarkCents: true,
      autonomyEnabled: true,
      isComparison: true,
    },
  });
  if (!campaign) return null;

  const summary = await summaryFor(campaign);

  // Bankroll history straight off the append-only ledger — newest 500, then
  // reversed to chronological, matching the overview's bankroll chart.
  const historyRows = (
    await prisma.paperLedgerEntry.findMany({
      where: { campaignId: botId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 500,
      select: { occurredAt: true, balanceAfterCents: true },
    })
  ).reverse();
  const bankrollHistory: BankrollHistoryPointDto[] = historyRows.map(
    (entry) => ({
      at: entry.occurredAt.toISOString(),
      settledCents: entry.balanceAfterCents,
    }),
  );

  const withdrawals = await prisma.paperLedgerEntry.aggregate({
    where: { campaignId: botId, kind: "withdrawal" },
    _sum: { amountCents: true },
  });

  // Positions scoped to this bot, marked to the freshest bid on the held side —
  // the same shape the Activity positions table consumes.
  const positions = await prisma.paperPosition.findMany({
    where: { campaignId: botId },
    orderBy: { openedAt: "desc" },
    include: {
      contract: {
        select: {
          kalshiPlayerName: true,
          statType: true,
          threshold: true,
          player: { select: { fullName: true } },
        },
      },
    },
  });
  const observations = await prisma.priceObservation.findMany({
    where: { contractId: { in: positions.map((p) => p.contractId) } },
    orderBy: { observedAt: "desc" },
    distinct: ["contractId"],
    select: { contractId: true, yesBidCents: true, noBidCents: true },
  });
  const byContract = new Map(observations.map((o) => [o.contractId, o]));

  const openPositionCount = positions.filter((p) => p.status === "open").length;

  const positionRows: PositionRowDto[] = positions.map((position) => {
    const observation = byContract.get(position.contractId);
    const bid =
      position.status !== "open"
        ? null
        : position.side === "yes"
          ? (observation?.yesBidCents ?? null)
          : (observation?.noBidCents ?? null);
    return {
      positionId: position.id,
      contractId: position.contractId,
      playerName:
        position.contract.player?.fullName ??
        position.contract.kalshiPlayerName ??
        "Unresolved contract",
      statType: position.contract.statType,
      threshold:
        position.contract.threshold === null
          ? null
          : Number(position.contract.threshold),
      side: position.side,
      contracts: position.contracts,
      costBasisCents: position.costBasisCents,
      feesPaidCents: position.feesPaidCents,
      intendedStakeCents: position.intendedStakeCents,
      unfilledStakeCents: Math.max(
        0,
        position.intendedStakeCents -
          (position.costBasisCents + position.feesPaidCents),
      ),
      markCents: bid === null ? null : bid * position.contracts,
      status: position.status,
      settlementResult: position.settlementResult,
      realizedPnlCents: position.realizedPnlCents,
      openedAt: position.openedAt.toISOString(),
      settledAt: position.settledAt?.toISOString() ?? null,
    };
  });

  const cycles = await prisma.paperCycle.findMany({
    where: { campaignId: botId },
    orderBy: { startedAt: "desc" },
    take: 20,
    include: {
      game: {
        select: {
          kickoffAt: true,
          homeTeam: { select: { nflverseAbbr: true } },
          awayTeam: { select: { nflverseAbbr: true } },
        },
      },
    },
  });

  return {
    summary,
    withdrawnCents: Math.abs(withdrawals._sum.amountCents ?? 0),
    highWaterMarkCents: campaign.highWaterMarkCents,
    bankrollHistory,
    positions: positionRows,
    openPositionCount,
    settledPositionCount: positions.length - openPositionCount,
    recentCycles: cycles.map(toCycleRow),
  };
}
