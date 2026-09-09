import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  ActiveBreachesDto,
  AutonomyOverviewDto,
  AutonomyStatusDto,
  BreachDto,
  CandidateDto,
  ConfigurationDto,
  CycleDetailDto,
  CycleRowDto,
  ExposureMeterDto,
  MoneyDto,
  PositionRowDto,
  RiskModeDto,
} from "@/lib/dto/autonomy";
import { MONEY_UNAVAILABLE, money } from "@/lib/dto/autonomy";
import { REQUIRED_PAPER_WEEKS, EXECUTION_WINDOW_HOURS } from "./config";
import { halts } from "./breakers";
import { readCampaignState } from "./state";

/**
 * Reads for the Autonomy surfaces.
 *
 * Every figure is assembled server-side at request time. Nothing on these
 * screens is a stored aggregate: the bankroll comes from the append-only
 * ledger, exposure from open positions, drawdown from the high-water mark
 * against a fresh mark-to-market, and the safety state from a fresh breaker
 * evaluation. The one exception is the high-water mark itself, which is
 * path-dependent and stored for exactly that reason.
 *
 * **Dry runs and replays are unreachable from here.** They live in their own
 * tables and nothing in this module queries them, which is how "a dry run
 * alters no bankroll" stays true without a filter every future query has to
 * remember.
 */

const CONDITION_COPY: Record<
  BreachDto["condition"],
  { label: string; description: string }
> = {
  drawdown_warning: {
    label: "drawdown warning",
    description:
      "active bankroll has fallen from its high-water mark, measured mark-to-market",
  },
  drawdown_halt: {
    label: "drawdown halt",
    description:
      "active bankroll below the high-water mark by more than the mode's halt threshold, measured mark-to-market",
  },
  calibration: {
    label: "calibration",
    description:
      "rolling Brier has degraded against the backtest record, or fallen behind the market",
  },
  exposure: {
    label: "exposure",
    description: "open exposure exceeds the per-slate cap",
  },
  kill_switch: {
    label: "kill switch",
    description: "the kill switch is engaged",
  },
};

export function deriveStatus(inputs: {
  killSwitchEngaged: boolean;
  autonomyEnabled: boolean;
  activeHaltingBreaches: number;
}): AutonomyStatusDto {
  // Derived on read, never stored. A status column would be one more thing
  // that can fall out of step with the conditions it claims to summarise.
  if (inputs.killSwitchEngaged) return "killed";
  if (!inputs.autonomyEnabled) return "disabled";
  if (inputs.activeHaltingBreaches > 0) return "halted";
  return "active";
}

function toBreachDto(breach: {
  id: string;
  condition: BreachDto["condition"];
  measuredDisplay: string;
  thresholdDisplay: string;
  trippedAt: Date;
  resolution: BreachDto["resolution"];
  resolvedAt: Date | null;
  resolvedBy: { displayName: string | null; email: string } | null;
}): BreachDto {
  const copy = CONDITION_COPY[breach.condition];
  return {
    id: breach.id,
    condition: breach.condition,
    label: copy.label,
    conditionDescription: copy.description,
    measuredDisplay: breach.measuredDisplay,
    thresholdDisplay: breach.thresholdDisplay,
    trippedAt: breach.trippedAt.toISOString(),
    resolution: breach.resolution,
    resolvedAt: breach.resolvedAt?.toISOString() ?? null,
    resolvedByDisplayName:
      breach.resolvedBy?.displayName ?? breach.resolvedBy?.email ?? null,
    halts: halts(breach.condition),
  };
}

function toRiskModeDto(config: {
  mode: RiskModeDto["mode"];
  kellyFraction: unknown;
  perGameCapPct: number;
  perSlateCapPct: number;
  drawdownWarnPct: number;
  drawdownHaltPct: number;
  probabilityCeiling: unknown;
  withdrawalCeilingMultiple: unknown;
}): RiskModeDto {
  return {
    mode: config.mode,
    kellyFraction: Number(config.kellyFraction),
    perGameCapPct: config.perGameCapPct,
    perSlateCapPct: config.perSlateCapPct,
    drawdownWarnPct: config.drawdownWarnPct,
    drawdownHaltPct: config.drawdownHaltPct,
    probabilityCeiling: Number(config.probabilityCeiling),
    withdrawalCeilingMultiple: Number(config.withdrawalCeilingMultiple),
  };
}

export async function readAutonomyOverview(): Promise<AutonomyOverviewDto | null> {
  const state = await readCampaignState();
  if (!state) return null;

  const stored = await prisma.paperBreach.findMany({
    where: { campaignId: state.campaignId, resolution: "active" },
    orderBy: { trippedAt: "desc" },
    include: { resolvedBy: { select: { displayName: true, email: true } } },
  });
  const breaches = stored.map(toBreachDto);

  const withdrawals = await prisma.paperLedgerEntry.aggregate({
    where: { campaignId: state.campaignId, kind: "withdrawal" },
    _sum: { amountCents: true },
  });
  const cumulativeWithdrawalsCents = Math.abs(
    withdrawals._sum.amountCents ?? 0,
  );

  const activeBankroll: MoneyDto = state.mark.available
    ? money(state.mark.markCents)
    : MONEY_UNAVAILABLE;
  const totalPaperWealth: MoneyDto = state.mark.available
    ? money(state.mark.markCents + cumulativeWithdrawalsCents)
    : MONEY_UNAVAILABLE;
  const netPaperPnl: MoneyDto = state.mark.available
    ? money(
        state.mark.markCents +
          cumulativeWithdrawalsCents -
          state.startingBankrollCents,
      )
    : MONEY_UNAVAILABLE;

  const openByGame = await prisma.paperPosition.findMany({
    where: { campaignId: state.campaignId, status: "open" },
    select: {
      costBasisCents: true,
      feesPaidCents: true,
      contract: {
        select: {
          gameId: true,
          game: {
            select: {
              kickoffAt: true,
              homeTeam: { select: { nflverseAbbr: true } },
              awayTeam: { select: { nflverseAbbr: true } },
            },
          },
        },
      },
    },
  });

  const games = new Map<string, ExposureMeterDto>();
  for (const position of openByGame) {
    const gameId = position.contract.gameId;
    const game = position.contract.game;
    if (!gameId || !game) continue;
    const label = `${game.awayTeam.nflverseAbbr} @ ${game.homeTeam.nflverseAbbr}`;
    const existing = games.get(gameId);
    const used =
      (existing?.usedCents ?? 0) +
      position.costBasisCents +
      position.feesPaidCents;
    games.set(gameId, {
      key: gameId,
      label,
      usedCents: used,
      capCents: state.gameCapacityCents,
      capPct: state.riskConfig?.perGameCapPct ?? 0,
    });
  }

  // Newest 500, then reversed for the chart. Ascending with a `take` returns
  // the OLDEST 500, so a campaign past that many entries — a couple of Sundays
  // at two entries a fill plus settlement credits — would freeze the bankroll
  // chart at the opening weeks while the balance beside it kept moving.
  const history = (
    await prisma.paperLedgerEntry.findMany({
      where: { campaignId: state.campaignId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 500,
      select: { occurredAt: true, balanceAfterCents: true },
    })
  ).reverse();

  const cycles = await prisma.paperCycle.findMany({
    where: { campaignId: state.campaignId },
    orderBy: { startedAt: "desc" },
    take: 4,
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

  const now = new Date();
  const nextGame = await prisma.game.findFirst({
    where: { status: "scheduled", kickoffAt: { gt: now } },
    orderBy: { kickoffAt: "asc" },
    select: { kickoffAt: true },
  });

  const lastPrice = await prisma.priceObservation.findFirst({
    orderBy: { observedAt: "desc" },
    select: { observedAt: true },
  });

  const readiness = await readReadinessSummary(state.campaignId);

  let emptyReason: AutonomyOverviewDto["emptyReason"] = null;
  if (!state.autonomyEnabled && cycles.length === 0) {
    emptyReason = "not_enabled";
  } else if (!nextGame) {
    emptyReason = "offseason";
  } else if (cycles.length === 0) {
    emptyReason = "no_cycles_this_week";
  }

  return {
    status: deriveStatus({
      killSwitchEngaged: state.killSwitchEngaged,
      autonomyEnabled: state.autonomyEnabled,
      activeHaltingBreaches: breaches.filter((breach) => breach.halts).length,
    }),
    killSwitchEngaged: state.killSwitchEngaged,
    autonomyEnabled: state.autonomyEnabled,
    mode: state.riskConfig ? toRiskModeDto({ ...state.riskConfig }) : null,
    figures: {
      startingBankrollCents: state.startingBankrollCents,
      settledBalanceCents: state.settledBalanceCents,
      openExposureCents: state.openExposureCents,
      activeBankroll,
      cumulativeWithdrawalsCents,
      totalPaperWealth,
      netPaperPnl,
      maxDrawdownBps: state.drawdownBps,
      highWaterMarkCents: state.highWaterMarkCents,
      markToMarketAvailable: state.mark.available,
      priceLastFetchedAt: lastPrice?.observedAt.toISOString() ?? null,
    },
    exposure: {
      slate: state.riskConfig
        ? {
            key: "slate",
            label: "Slate",
            usedCents: state.openExposureCents,
            capCents: state.slateCapacityCents,
            capPct: state.riskConfig.perSlateCapPct,
          }
        : null,
      games: [...games.values()].sort((a, b) => (a.label < b.label ? -1 : 1)),
    },
    history: history.map((entry) => ({
      at: entry.occurredAt.toISOString(),
      settledCents: entry.balanceAfterCents,
      markCents: null,
    })),
    breaches,
    recentCycles: cycles.map(toCycleRow),
    readiness,
    emptyReason,
    nextWindowOpensAt: nextGame
      ? new Date(
          nextGame.kickoffAt.getTime() -
            EXECUTION_WINDOW_HOURS * 60 * 60 * 1000,
        ).toISOString()
      : null,
    lastCycleAt: cycles[0]?.startedAt.toISOString() ?? null,
  };
}

function toCycleRow(cycle: {
  id: string;
  startedAt: Date;
  outcome: CycleRowDto["outcome"];
  skipReason: string | null;
  candidatesEvaluated: number;
  candidatesSized: number;
  candidatesFilled: number;
  stakedCents: number;
  game: {
    kickoffAt: Date;
    homeTeam: { nflverseAbbr: string };
    awayTeam: { nflverseAbbr: string };
  };
}): CycleRowDto {
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
  };
}

export async function readCycles(scope: {
  season?: number;
  week?: number;
}): Promise<{
  rows: CycleRowDto[];
  seasons: number[];
  weeks: number[];
  season: number | null;
  week: number | null;
}> {
  const campaign = await prisma.paperCampaign.findFirst({
    orderBy: { startedAt: "asc" },
    select: { id: true },
  });
  if (!campaign) {
    return { rows: [], seasons: [], weeks: [], season: null, week: null };
  }

  const withGames = await prisma.paperCycle.findMany({
    where: { campaignId: campaign.id },
    orderBy: { startedAt: "desc" },
    include: {
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

  const seasons = [...new Set(withGames.map((c) => c.game.season))].sort(
    (a, b) => b - a,
  );
  const season = scope.season ?? seasons[0] ?? null;
  const inSeason = withGames.filter((c) => c.game.season === season);
  const weeks = [...new Set(inSeason.map((c) => c.game.week))].sort(
    (a, b) => b - a,
  );
  const week = scope.week ?? weeks[0] ?? null;

  return {
    rows: inSeason
      .filter((c) => week === null || c.game.week === week)
      .map(toCycleRow),
    seasons,
    weeks,
    season,
    week,
  };
}

export async function readCycleDetail(
  cycleId: string,
): Promise<CycleDetailDto | null> {
  const cycle = await prisma.paperCycle.findUnique({
    where: { id: cycleId },
    include: {
      riskConfig: true,
      recalibration: {
        select: {
          version: true,
          liveObservationCount: true,
          backtestRun: {
            select: { label: true, seasonFrom: true, seasonTo: true },
          },
        },
      },
      game: {
        select: {
          kickoffAt: true,
          homeTeam: { select: { nflverseAbbr: true } },
          awayTeam: { select: { nflverseAbbr: true } },
        },
      },
      candidates: {
        orderBy: { rank: "asc" },
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
      },
    },
  });
  if (!cycle) return null;

  return {
    cycleId: cycle.id,
    gameLabel: `${cycle.game.awayTeam.nflverseAbbr} @ ${cycle.game.homeTeam.nflverseAbbr}`,
    kickoffAt: cycle.game.kickoffAt.toISOString(),
    startedAt: cycle.startedAt.toISOString(),
    finishedAt: cycle.finishedAt?.toISOString() ?? null,
    outcome: cycle.outcome,
    reason: cycle.skipReason,
    mode: toRiskModeDto(cycle.riskConfig),
    recalibration: cycle.recalibration
      ? {
          version: cycle.recalibration.version,
          backtestLabel:
            cycle.recalibration.backtestRun.label ??
            `${cycle.recalibration.backtestRun.seasonFrom}–${cycle.recalibration.backtestRun.seasonTo}`,
          liveObservationCount: cycle.recalibration.liveObservationCount,
        }
      : null,
    bankrollAtEvaluationCents: cycle.bankrollAtEvaluationCents,
    slateCapacityCents: cycle.slateCapacityCents,
    gameCapacityCents: cycle.gameCapacityCents,
    candidates: cycle.candidates.map((candidate): CandidateDto => ({
      contractId: candidate.contractId,
      rank: candidate.rank,
      playerName:
        candidate.contract.player?.fullName ??
        candidate.contract.kalshiPlayerName ??
        "Unresolved contract",
      teamAbbreviation: null,
      statType: candidate.contract.statType,
      threshold:
        candidate.contract.threshold === null
          ? null
          : Number(candidate.contract.threshold),
      rawProbability:
        candidate.rawProbability === null
          ? null
          : Number(candidate.rawProbability),
      correctedProbability:
        candidate.correctedProbability === null
          ? null
          : Number(candidate.correctedProbability),
      confidence: candidate.confidence,
      side: candidate.side,
      askCents: candidate.askCents,
      feeCents: candidate.feeCents,
      netPriceCents: candidate.netPriceCents,
      topOfBookSizeContracts: candidate.topOfBookSizeContracts,
      kellyEdge:
        candidate.kellyEdge === null ? null : Number(candidate.kellyEdge),
      kellyFractionApplied:
        candidate.kellyFractionApplied === null
          ? null
          : Number(candidate.kellyFractionApplied),
      intendedStakeCents: candidate.intendedStakeCents,
      intendedContracts: candidate.intendedContracts,
      filledContracts: candidate.filledContracts,
      filledCostCents: candidate.filledCostCents,
      filledFeeCents: candidate.filledFeeCents,
      unfilledStakeCents: Math.max(
        0,
        candidate.intendedStakeCents -
          (candidate.filledCostCents + candidate.filledFeeCents),
      ),
      verdict: candidate.verdict,
      boundBy: candidate.boundBy,
      boundByDetail: candidate.boundByDetail,
    })),
    allocationTrace: Array.isArray(cycle.allocationTrace)
      ? (cycle.allocationTrace as string[])
      : [],
  };
}

export async function readPositions(
  status: "open" | "settled" | "all",
): Promise<{
  rows: PositionRowDto[];
  openCount: number;
  settledCount: number;
}> {
  const campaign = await prisma.paperCampaign.findFirst({
    orderBy: { startedAt: "asc" },
    select: { id: true },
  });
  if (!campaign) return { rows: [], openCount: 0, settledCount: 0 };

  const positions = await prisma.paperPosition.findMany({
    where: { campaignId: campaign.id },
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
      };
    });

  return { rows, openCount, settledCount };
}

export async function readConfiguration(): Promise<ConfigurationDto> {
  const state = await readCampaignState();
  if (!state) {
    return {
      mode: null,
      autonomyEnabled: false,
      startingBankrollCents: 0,
      startingBankrollEditable: true,
      hasActiveHaltingBreach: false,
    };
  }

  const fills = await prisma.paperFill.count();
  const stored = await prisma.paperBreach.findMany({
    where: { campaignId: state.campaignId, resolution: "active" },
    select: { condition: true },
  });

  return {
    mode: state.riskConfig ? toRiskModeDto({ ...state.riskConfig }) : null,
    autonomyEnabled: state.autonomyEnabled,
    startingBankrollCents: state.startingBankrollCents,
    startingBankrollEditable: fills === 0,
    hasActiveHaltingBreach: stored.some((breach) => halts(breach.condition)),
  };
}

export async function readActiveBreaches(): Promise<ActiveBreachesDto> {
  const campaign = await prisma.paperCampaign.findFirst({
    orderBy: { startedAt: "asc" },
    select: { id: true, killSwitchEngaged: true },
  });
  if (!campaign) {
    return { campaignExists: false, killSwitchEngaged: false, breaches: [] };
  }

  const stored = await prisma.paperBreach.findMany({
    where: { campaignId: campaign.id, resolution: "active" },
    orderBy: { trippedAt: "desc" },
    include: { resolvedBy: { select: { displayName: true, email: true } } },
  });

  return {
    campaignExists: true,
    killSwitchEngaged: campaign.killSwitchEngaged,
    breaches: stored.map(toBreachDto).filter((breach) => breach.halts),
  };
}

/**
 * The readiness headline the overview shows.
 *
 * A "complete" week is one where every scheduled game has kicked off AND every
 * position opened in it has settled or voided. A week still resolving is not
 * evidence yet, and counting it would be the shortcut the pitch names.
 */
export async function readReadinessSummary(campaignId: string): Promise<{
  state: AutonomyOverviewDto["readiness"]["state"];
  weeksComplete: number;
  weeksRequired: number;
}> {
  const fills = await prisma.paperFill.findMany({
    where: { position: { campaignId } },
    select: {
      position: {
        select: {
          status: true,
          contract: {
            select: { game: { select: { season: true, week: true } } },
          },
        },
      },
    },
  });

  const byWeek = new Map<string, { total: number; resolved: number }>();
  for (const fill of fills) {
    const game = fill.position.contract.game;
    if (!game) continue;
    const key = `${game.season}-${game.week}`;
    const entry = byWeek.get(key) ?? { total: 0, resolved: 0 };
    entry.total += 1;
    if (fill.position.status !== "open") entry.resolved += 1;
    byWeek.set(key, entry);
  }

  const weeksComplete = [...byWeek.values()].filter(
    (week) => week.total > 0 && week.total === week.resolved,
  ).length;

  // This summary deliberately never reports `eligible_for_live_trading`. It
  // knows only about paper weeks; eligibility also requires the model-quality
  // and safety evidence the readiness surface evaluates in full. Reporting
  // eligibility from a partial view would be the shortcut the pitch warns
  // against — mistaking a short profitable stretch for proof.
  return {
    state: weeksComplete === 0 ? "not_ready" : "paper_evidence_building",
    weeksComplete,
    weeksRequired: REQUIRED_PAPER_WEEKS,
  };
}
