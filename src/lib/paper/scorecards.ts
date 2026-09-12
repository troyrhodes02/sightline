import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  PortfolioScorecardDto,
  ScorecardPeriod,
} from "@/lib/dto/model-eval";
import type { PaperPortfolio } from "../../../generated/prisma/enums";
import {
  bidOnHeldSide,
  drawdownBps,
  markToMarket,
  type OpenPositionMark,
} from "./bankroll";

/**
 * Per-portfolio scorecards for one paper-evaluation campaign (PME-5, spec §UI
 * data contracts, D5/D11/D17/D19/D20).
 *
 * One row per portfolio (baseline / simulation / hybrid). Every figure is
 * assembled server-side from the append-only ledger, open positions, and the
 * cycle records — nothing is a stored aggregate, matching the on-read posture
 * of every other paper surface. The three rows are returned side by side and
 * NEVER summed: paper figures are never aggregated with one another or with any
 * future live-money ledger (D20).
 *
 * The `period` filter windows the OPPORTUNITY aggregates (candidates evaluated /
 * sized, positions opened in the window) and the P&L is always measured against
 * the campaign's real starting bankroll and the current mark. A period never
 * resets the bankroll — a two-week view is a lens onto a continuous campaign,
 * not a fresh account.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * The start of the window a period covers, or null for the whole campaign. The
 * window is a rolling number of NFL-length weeks back from `now`; it bounds
 * which cycles and freshly-opened positions count, and nothing else.
 */
export function periodWindowStart(
  period: ScorecardPeriod,
  now: Date,
): Date | null {
  switch (period) {
    case "campaign":
      return null;
    case "current_week":
      return new Date(now.getTime() - MS_PER_WEEK);
    case "previous_week":
    case "two_week":
      return new Date(now.getTime() - 2 * MS_PER_WEEK);
  }
}

/**
 * For `previous_week` the window is the week BEFORE the current one, so it also
 * carries an upper bound. Every other period runs up to `now`.
 */
function periodWindowEnd(period: ScorecardPeriod, now: Date): Date | null {
  return period === "previous_week"
    ? new Date(now.getTime() - MS_PER_WEEK)
    : null;
}

const RISK_MODE_FALLBACK: PortfolioScorecardDto["riskMode"] = "custom";

/**
 * The financial figures for ONE paper campaign (bot), assembled server-side from
 * the append-only ledger, its open positions marked to market, and its latest
 * risk config. Shared by the per-portfolio scorecard (Model Performance) and the
 * Paper Bot Lab reads so a bot's numbers mean exactly the same on both surfaces.
 *
 * Mark-dependent figures are null (not 0) when any open position lacks a usable
 * bid — a degraded read is a distinct state from a real zero.
 */
export async function campaignFinancials(campaign: {
  id: string;
  startingBankrollCents: number;
  highWaterMarkCents: number;
}): Promise<{
  activeBankrollCents: number | null;
  withdrawnCents: number;
  netPnlCents: number | null;
  returnPct: number | null;
  maxDrawdownBps: number | null;
  positionCount: number;
  riskMode: PortfolioScorecardDto["riskMode"];
}> {
  const [lastEntry, openPositions] = await Promise.all([
    prisma.paperLedgerEntry.findFirst({
      where: { campaignId: campaign.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { balanceAfterCents: true },
    }),
    prisma.paperPosition.findMany({
      where: { campaignId: campaign.id, status: "open" },
      select: {
        id: true,
        contractId: true,
        side: true,
        contracts: true,
        costBasisCents: true,
        feesPaidCents: true,
      },
    }),
  ]);
  const settledBalanceCents = lastEntry?.balanceAfterCents ?? 0;
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

  const [withdrawals, positionCount, config] = await Promise.all([
    prisma.paperLedgerEntry.aggregate({
      where: { campaignId: campaign.id, kind: "withdrawal" },
      _sum: { amountCents: true },
    }),
    prisma.paperPosition.count({ where: { campaignId: campaign.id } }),
    prisma.paperRiskConfig.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { effectiveFrom: "desc" },
      select: { mode: true },
    }),
  ]);
  const withdrawnCents = Math.abs(withdrawals._sum.amountCents ?? 0);

  const activeBankrollCents = mark.available ? mark.markCents : null;
  const totalValueCents =
    activeBankrollCents === null ? null : activeBankrollCents + withdrawnCents;
  const netPnlCents =
    totalValueCents === null
      ? null
      : totalValueCents - campaign.startingBankrollCents;
  const returnPct =
    netPnlCents === null || campaign.startingBankrollCents <= 0
      ? null
      : (netPnlCents / campaign.startingBankrollCents) * 100;
  const maxDrawdownBps = drawdownBps(campaign.highWaterMarkCents, mark);

  return {
    activeBankrollCents,
    withdrawnCents,
    netPnlCents,
    returnPct,
    maxDrawdownBps,
    positionCount,
    riskMode: config?.mode ?? RISK_MODE_FALLBACK,
  };
}

async function scorecardForPortfolio(
  campaign: {
    id: string;
    portfolio: PaperPortfolio;
    startingBankrollCents: number;
    highWaterMarkCents: number;
  },
  period: ScorecardPeriod,
  now: Date,
): Promise<PortfolioScorecardDto> {
  const windowStart = periodWindowStart(period, now);
  const windowEnd = periodWindowEnd(period, now);
  const startedAtFilter =
    windowStart || windowEnd
      ? {
          ...(windowStart ? { gte: windowStart } : {}),
          ...(windowEnd ? { lt: windowEnd } : {}),
        }
      : undefined;

  // --- Bankroll, mark-to-market, drawdown --------------------------------
  // Measured against the WHOLE campaign, never the window: a period is a lens,
  // not a reset. The settled balance is the running ledger total; the mark adds
  // the market value of currently-open positions.
  // The running-total ledger tail and the open positions are independent reads;
  // fetch them together rather than serially.
  const [lastEntry, openPositions] = await Promise.all([
    prisma.paperLedgerEntry.findFirst({
      where: { campaignId: campaign.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { balanceAfterCents: true },
    }),
    prisma.paperPosition.findMany({
      where: { campaignId: campaign.id, status: "open" },
      select: {
        id: true,
        contractId: true,
        side: true,
        contracts: true,
        costBasisCents: true,
        feesPaidCents: true,
      },
    }),
  ]);
  const settledBalanceCents = lastEntry?.balanceAfterCents ?? 0;
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

  // These five reads share no data dependency — the cumulative withdrawal, the
  // windowed opportunity counts (D5), the windowed position/breaker counts, and
  // the active risk mode — so they run together rather than as five serial
  // round-trips per portfolio.
  const [withdrawals, cycleAgg, positionCount, breakerEventCount, config] =
    await Promise.all([
      prisma.paperLedgerEntry.aggregate({
        where: { campaignId: campaign.id, kind: "withdrawal" },
        _sum: { amountCents: true },
      }),
      prisma.paperCycle.aggregate({
        where: {
          campaignId: campaign.id,
          ...(startedAtFilter ? { startedAt: startedAtFilter } : {}),
        },
        _sum: { candidatesEvaluated: true, candidatesSized: true },
      }),
      // Positions opened in the window (the whole campaign for `campaign`).
      prisma.paperPosition.count({
        where: {
          campaignId: campaign.id,
          ...(startedAtFilter ? { openedAt: startedAtFilter } : {}),
        },
      }),
      prisma.paperBreach.count({
        where: {
          campaignId: campaign.id,
          ...(startedAtFilter ? { trippedAt: startedAtFilter } : {}),
        },
      }),
      prisma.paperRiskConfig.findFirst({
        where: { campaignId: campaign.id },
        orderBy: { effectiveFrom: "desc" },
        select: { mode: true },
      }),
    ]);
  const withdrawnCents = Math.abs(withdrawals._sum.amountCents ?? 0);

  // null (mark unavailable) is a distinct state from a real 0: when the mark is
  // degraded, everything that depends on it reports null rather than a
  // settled-only substitute.
  const activeBankrollCents = mark.available ? mark.markCents : null;
  const totalValueCents =
    activeBankrollCents === null ? null : activeBankrollCents + withdrawnCents;
  const netPnlCents =
    totalValueCents === null
      ? null
      : totalValueCents - campaign.startingBankrollCents;
  const returnPct =
    netPnlCents === null || campaign.startingBankrollCents <= 0
      ? null
      : (netPnlCents / campaign.startingBankrollCents) * 100;
  const maxDrawdownBps = drawdownBps(campaign.highWaterMarkCents, mark);

  return {
    portfolio: campaign.portfolio,
    startingBankrollCents: campaign.startingBankrollCents,
    activeBankrollCents,
    withdrawnCents,
    totalValueCents,
    netPnlCents,
    returnPct,
    maxDrawdownBps,
    candidatesEvaluated: cycleAgg._sum.candidatesEvaluated ?? 0,
    candidatesSized: cycleAgg._sum.candidatesSized ?? 0,
    positionCount,
    riskMode: config?.mode ?? RISK_MODE_FALLBACK,
    breakerEventCount,
  };
}

/**
 * The three (or two) portfolio scorecards for a campaign, in a stable order
 * (baseline, simulation, hybrid). Hybrid is present only when its portfolio was
 * provisioned — i.e. a hybrid selection existed (D11).
 */
export async function readPortfolioScorecards(
  evaluationCampaignId: string,
  period: ScorecardPeriod = "campaign",
  now: Date = new Date(),
): Promise<PortfolioScorecardDto[]> {
  const portfolios = await prisma.paperCampaign.findMany({
    // Only the three canonical COMPARISON bots power Model Performance's engine
    // comparison (Paper Bot Lab). A custom Lab bot sharing an engine must never
    // appear here or the surface would show more than three columns and could
    // pair a custom bankroll with an engine's name.
    where: { evaluationCampaignId, isComparison: true },
    select: {
      id: true,
      portfolio: true,
      startingBankrollCents: true,
      highWaterMarkCents: true,
    },
  });

  const order: Record<PaperPortfolio, number> = {
    baseline: 0,
    simulation: 1,
    hybrid: 2,
  };
  const sorted = [...portfolios].sort(
    (a, b) => order[a.portfolio] - order[b.portfolio],
  );

  // Assembled independently per portfolio and returned as a list; they are
  // never summed here or anywhere downstream (D20).
  return Promise.all(
    sorted.map((campaign) => scorecardForPortfolio(campaign, period, now)),
  );
}
