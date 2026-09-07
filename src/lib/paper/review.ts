import "server-only";

import { prisma } from "@/lib/prisma";
import { calibrationSample } from "./calibration-window";
import type { PeriodKind } from "./replay";

/**
 * Paper performance review.
 *
 * The twelve figures the pitch requires, over a game window, an NFL week, or
 * the campaign to date. Three things this module is careful about:
 *
 * **Fill quality is a first-class figure**, not a footnote. Complete, partial,
 * and unfilled are counted separately, because "the ledger should represent
 * what realistically would have happened, not what the sizing formula wished"
 * is only checkable if the wishes are still countable.
 *
 * **A force override never ages into `cleared`.** Safety events render their
 * stored resolution verbatim, with actor and time, permanently. Reports must
 * retain the fact that the bot wanted to stop and was deliberately overruled.
 *
 * **Model quality is quoted, not recomputed.** The rolling Brier, the backtest
 * reference and the market comparison come from the same source the accuracy
 * surface uses, so the two cannot disagree, and they are labelled as a separate
 * kind of evidence from the financial result beside them.
 */

export type ReviewPeriod = {
  kind: PeriodKind;
  key: string;
  label: string;
};

export type SafetyEvent = {
  id: string;
  condition: string;
  measuredDisplay: string;
  thresholdDisplay: string;
  trippedAt: string;
  resolution: "active" | "cleared" | "force_overridden";
  resolvedAt: string | null;
  resolvedByDisplayName: string | null;
};

export type Review = {
  period: ReviewPeriod;
  modesUsed: string[];
  startingBankrollCents: number;
  endingActiveBankrollCents: number;
  netPaperPnlCents: number;
  cumulativeWithdrawalsCents: number;
  totalPaperWealthCents: number;
  maxDrawdownBps: number | null;
  positionCount: number;
  settledCount: number;
  fillQuality: { complete: number; partial: number; unfilled: number };
  safetyEvents: SafetyEvent[];
  modelQuality: {
    rollingBrier: number | null;
    backtestBrier: number | null;
    marketBrier: number | null;
    gradedObservations: number;
  };
};

/** Periods with cycles, newest first, plus campaign-to-date. */
export async function reviewPeriods(
  campaignId: string,
  kind: PeriodKind,
): Promise<ReviewPeriod[]> {
  if (kind === "campaign") {
    return [{ kind: "campaign", key: "campaign", label: "Campaign to date" }];
  }

  const cycles = await prisma.paperCycle.findMany({
    where: { campaignId },
    orderBy: { startedAt: "desc" },
    select: {
      game: {
        select: {
          season: true,
          week: true,
          kickoffAt: true,
          homeTeam: { select: { nflverseAbbr: true } },
          awayTeam: { select: { nflverseAbbr: true } },
        },
      },
    },
  });

  const seen = new Map<string, ReviewPeriod>();
  for (const cycle of cycles) {
    if (kind === "week") {
      const key = `${cycle.game.season}-w${cycle.game.week}`;
      if (!seen.has(key)) {
        seen.set(key, {
          kind: "week",
          key,
          label: `${cycle.game.season} week ${cycle.game.week}`,
        });
      }
    } else {
      const key = cycle.game.kickoffAt.toISOString();
      if (!seen.has(key)) {
        seen.set(key, {
          kind: "game_window",
          key,
          label: `${cycle.game.awayTeam.nflverseAbbr} @ ${cycle.game.homeTeam.nflverseAbbr} · ${new Intl.DateTimeFormat(
            "en-US",
            {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            },
          ).format(cycle.game.kickoffAt)}`,
        });
      }
    }
  }
  return [...seen.values()];
}

export async function readReview(
  campaignId: string,
  period: ReviewPeriod,
): Promise<Review> {
  const campaign = await prisma.paperCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { startingBankrollCents: true },
  });

  const gameFilter =
    period.kind === "campaign"
      ? {}
      : period.kind === "week"
        ? {
            game: {
              season: Number(period.key.split("-w")[0]),
              week: Number(period.key.split("-w")[1]),
            },
          }
        : { game: { kickoffAt: new Date(period.key) } };

  const cycles = await prisma.paperCycle.findMany({
    where: { campaignId, ...gameFilter },
    orderBy: { startedAt: "asc" },
    include: {
      riskConfig: { select: { mode: true } },
      candidates: {
        select: {
          verdict: true,
          intendedContracts: true,
          filledContracts: true,
          contractId: true,
        },
      },
    },
  });

  const contractIds = [
    ...new Set(
      cycles.flatMap((cycle) =>
        cycle.candidates
          .filter((candidate) => candidate.filledContracts > 0)
          .map((candidate) => candidate.contractId),
      ),
    ),
  ];

  const positions = await prisma.paperPosition.findMany({
    where: { campaignId, contractId: { in: contractIds } },
    select: {
      status: true,
      realizedPnlCents: true,
      costBasisCents: true,
      feesPaidCents: true,
    },
  });

  // Fill quality: three counts, never one. `unfilled` means the planner wanted
  // a stake and the book supplied nothing — a real, countable event that a
  // summary reporting only "positions taken" would erase.
  const fillQuality = { complete: 0, partial: 0, unfilled: 0 };
  for (const cycle of cycles) {
    for (const candidate of cycle.candidates) {
      if (candidate.verdict === "filled") fillQuality.complete += 1;
      else if (candidate.verdict === "partial") fillQuality.partial += 1;
      else if (
        candidate.verdict === "no_stake" &&
        candidate.intendedContracts > 0 &&
        candidate.filledContracts === 0
      ) {
        fillQuality.unfilled += 1;
      }
    }
  }

  const withdrawals = await prisma.paperLedgerEntry.aggregate({
    where: { campaignId, kind: "withdrawal" },
    _sum: { amountCents: true },
  });
  const cumulativeWithdrawalsCents = Math.abs(
    withdrawals._sum.amountCents ?? 0,
  );

  const lastEntry = await prisma.paperLedgerEntry.findFirst({
    where: { campaignId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { balanceAfterCents: true },
  });
  const settled = lastEntry?.balanceAfterCents ?? 0;
  const openExposure = positions
    .filter((position) => position.status === "open")
    .reduce(
      (sum, position) => sum + position.costBasisCents + position.feesPaidCents,
      0,
    );
  const endingActive = settled + openExposure;

  const breaches = await prisma.paperBreach.findMany({
    where: {
      campaignId,
      ...(cycles.length > 0
        ? {
            trippedAt: {
              gte: cycles[0].startedAt,
              lte: cycles[cycles.length - 1].finishedAt ?? new Date(),
            },
          }
        : {}),
    },
    orderBy: { trippedAt: "desc" },
    include: { resolvedBy: { select: { displayName: true, email: true } } },
  });

  const maxDrawdownBps = cycles
    .map((cycle) => cycle.drawdownBps)
    .filter((value): value is number => value !== null)
    .reduce<number | null>(
      (max, value) => (max === null || value > max ? value : max),
      null,
    );

  const calibration = await calibrationSample();

  return {
    period,
    modesUsed: [...new Set(cycles.map((cycle) => cycle.riskConfig.mode))],
    startingBankrollCents: campaign.startingBankrollCents,
    endingActiveBankrollCents: endingActive,
    netPaperPnlCents:
      endingActive +
      cumulativeWithdrawalsCents -
      campaign.startingBankrollCents,
    cumulativeWithdrawalsCents,
    totalPaperWealthCents: endingActive + cumulativeWithdrawalsCents,
    maxDrawdownBps,
    positionCount: positions.length,
    settledCount: positions.filter((position) => position.status !== "open")
      .length,
    fillQuality,
    safetyEvents: breaches.map((breach) => ({
      id: breach.id,
      condition: breach.condition,
      measuredDisplay: breach.measuredDisplay,
      thresholdDisplay: breach.thresholdDisplay,
      trippedAt: breach.trippedAt.toISOString(),
      // Rendered verbatim from storage. A force override never becomes
      // `cleared`, at any age — the report exists partly to keep that fact.
      resolution: breach.resolution,
      resolvedAt: breach.resolvedAt?.toISOString() ?? null,
      resolvedByDisplayName:
        breach.resolvedBy?.displayName ?? breach.resolvedBy?.email ?? null,
    })),
    modelQuality: {
      rollingBrier: calibration.rollingBrier,
      backtestBrier: calibration.backtestBrier,
      marketBrier: calibration.marketBrier,
      gradedObservations: calibration.observations,
    },
  };
}
