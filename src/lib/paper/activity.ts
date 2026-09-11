import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  ActivityDto,
  CycleRowDto,
  PositionRowDto,
} from "@/lib/dto/autonomy";
import type { PaperPortfolio } from "../../../generated/prisma/enums";

/**
 * Paper Bot → Activity reads (PME-6, D10/D6).
 *
 * Positions and cycles across ALL portfolios of the one evaluation campaign,
 * each row carrying its portfolio so the `All` view stays legible. Positions
 * additionally carry their permanent model attribution (`sourceModelVersion`),
 * read straight from the stored column — never recomputed from the current
 * selection, so a Hybrid position's originating engine never gets relabelled by
 * a later switch (D6).
 *
 * Every figure is assembled server-side at request time; nothing here is a
 * stored aggregate, and the three portfolios' records are never summed — this
 * module lists, it does not blend (D20).
 */

const PORTFOLIO_ORDER: Record<PaperPortfolio, number> = {
  baseline: 0,
  simulation: 1,
  hybrid: 2,
};

/** The evaluation campaign and its portfolios (campaignId → portfolio). */
async function portfolioMap(): Promise<{
  campaignExists: boolean;
  campaignIds: string[];
  portfolioByCampaignId: Map<string, PaperPortfolio>;
}> {
  const campaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: {
      portfolios: { select: { id: true, portfolio: true } },
    },
  });
  if (!campaign) {
    return {
      campaignExists: false,
      campaignIds: [],
      portfolioByCampaignId: new Map(),
    };
  }
  const portfolioByCampaignId = new Map(
    campaign.portfolios.map((p) => [p.id, p.portfolio]),
  );
  return {
    campaignExists: true,
    campaignIds: campaign.portfolios.map((p) => p.id),
    portfolioByCampaignId,
  };
}

export async function readActivity(scope: {
  view: "positions" | "cycles";
  portfolio: PaperPortfolio | "all";
  status: "open" | "settled" | "all";
}): Promise<ActivityDto> {
  const { campaignExists, campaignIds, portfolioByCampaignId } =
    await portfolioMap();

  if (!campaignExists) {
    return {
      view: scope.view,
      portfolio: scope.portfolio,
      status: scope.status,
      positions: [],
      cycles: [],
      openCount: 0,
      settledCount: 0,
      campaignExists: false,
    };
  }

  const selectedCampaignIds =
    scope.portfolio === "all"
      ? campaignIds
      : campaignIds.filter(
          (id) => portfolioByCampaignId.get(id) === scope.portfolio,
        );

  const [positions, cycles] = await Promise.all([
    readPositionsAcross(
      selectedCampaignIds,
      scope.status,
      portfolioByCampaignId,
    ),
    readCyclesAcross(selectedCampaignIds, portfolioByCampaignId),
  ]);

  return {
    view: scope.view,
    portfolio: scope.portfolio,
    status: scope.status,
    positions: positions.rows,
    cycles,
    openCount: positions.openCount,
    settledCount: positions.settledCount,
    campaignExists: true,
  };
}

async function readPositionsAcross(
  campaignIds: string[],
  status: "open" | "settled" | "all",
  portfolioByCampaignId: Map<string, PaperPortfolio>,
): Promise<{
  rows: PositionRowDto[];
  openCount: number;
  settledCount: number;
}> {
  if (campaignIds.length === 0) {
    return { rows: [], openCount: 0, settledCount: 0 };
  }

  const positions = await prisma.paperPosition.findMany({
    where: { campaignId: { in: campaignIds } },
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

  const openCount = positions.filter((p) => p.status === "open").length;
  const settledCount = positions.length - openCount;

  const rows = positions
    .filter((position) => {
      if (status === "all") return true;
      if (status === "open") return position.status === "open";
      return position.status !== "open";
    })
    .map((position): PositionRowDto => {
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
        portfolio: portfolioByCampaignId.get(position.campaignId),
        sourceModelVersion: position.sourceModelVersion,
      };
    });

  return { rows, openCount, settledCount };
}

async function readCyclesAcross(
  campaignIds: string[],
  portfolioByCampaignId: Map<string, PaperPortfolio>,
): Promise<CycleRowDto[]> {
  if (campaignIds.length === 0) return [];

  const cycles = await prisma.paperCycle.findMany({
    where: { campaignId: { in: campaignIds } },
    orderBy: { startedAt: "desc" },
    take: 100,
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

  return cycles.map((cycle): CycleRowDto => {
    const evaluated =
      cycle.outcome === "skipped" ? null : cycle.candidatesEvaluated;
    return {
      cycleId: cycle.id,
      startedAt: cycle.startedAt.toISOString(),
      gameLabel: `${cycle.game.awayTeam.nflverseAbbr} @ ${cycle.game.homeTeam.nflverseAbbr}`,
      kickoffAt: cycle.game.kickoffAt.toISOString(),
      outcome: cycle.outcome,
      reason: cycle.skipReason,
      candidatesEvaluated: evaluated,
      candidatesSized: evaluated === null ? null : cycle.candidatesSized,
      candidatesFilled: evaluated === null ? null : cycle.candidatesFilled,
      stakedCents: cycle.stakedCents > 0 ? cycle.stakedCents : null,
      portfolio: portfolioByCampaignId.get(cycle.campaignId),
    };
  });
}

export { PORTFOLIO_ORDER };
