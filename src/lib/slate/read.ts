import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import type {
  Confidence,
  MarketSide,
  StatType,
} from "../../../generated/prisma/enums";
import type {
  ContractDetailDto,
  SlateDto,
  SlateRowDto,
  UnresolvedRowDto,
} from "@/lib/dto/slate";
import {
  compareSlateRows,
  computeEdge,
  recommendationThresholdPoints,
} from "./edge";
import { probAtLeast } from "./probability";

/**
 * The slate read: the two-clock join, computed when someone looks.
 *
 * Freshest stored projection × freshest stored observation → probability,
 * edge, ranking, recommendation — derived here, returned in DTOs, and never
 * written back as current state. The ONE write this read performs is the
 * RD-4 snapshot trigger: when a contract's recommendation state has changed
 * since its last snapshot, the transition is frozen for later grading.
 *
 * Role split is structural: `viewer` payloads are built by code that never
 * queries decisions, so a decision key cannot leak into them.
 */

export type SlateRole = "admin" | "viewer";

export async function readSlate(role: SlateRole): Promise<SlateDto> {
  const now = new Date();

  const games = await prisma.game.findMany({
    where: { status: "scheduled", kickoffAt: { gt: now } },
    select: {
      id: true,
      kickoffAt: true,
      homeTeam: { select: { nflverseAbbr: true } },
      awayTeam: { select: { nflverseAbbr: true } },
    },
  });
  const gameById = new Map(games.map((game) => [game.id, game]));
  const gameIds = games.map((game) => game.id);

  const contracts = await prisma.contract.findMany({
    where: {
      status: "active",
      OR: [{ gameId: { in: gameIds } }, { gameId: null }],
    },
    select: {
      id: true,
      kalshiTicker: true,
      title: true,
      kalshiPlayerName: true,
      playerId: true,
      gameId: true,
      statType: true,
      threshold: true,
      resolutionStatus: true,
      resolutionNote: true,
      player: { select: { fullName: true } },
    },
  });

  const contractIds = contracts.map((contract) => contract.id);
  const latestObservations = await latestObservationByContract(contractIds);

  const resolved = contracts.filter(
    (contract) =>
      (contract.resolutionStatus === "resolved" ||
        contract.resolutionStatus === "manual_override") &&
      contract.playerId !== null &&
      contract.gameId !== null &&
      contract.statType !== null &&
      contract.threshold !== null &&
      gameById.has(contract.gameId),
  );
  const unresolvedContracts = contracts.filter(
    (contract) =>
      contract.resolutionStatus === "unresolved" ||
      contract.resolutionStatus === "ambiguous",
  );

  const projections = await freshestProjections(
    resolved.map((contract) => ({
      playerId: contract.playerId as string,
      gameId: contract.gameId as string,
      statType: contract.statType as StatType,
    })),
  );

  const thresholdPoints = recommendationThresholdPoints();
  const rows: SlateRowDto[] = [];
  const snapshotInputs: SnapshotInput[] = [];

  for (const contract of resolved) {
    const game = gameById.get(contract.gameId as string);
    if (!game) continue;
    const projection = projections.get(
      projectionKey(
        contract.playerId as string,
        contract.gameId as string,
        contract.statType as StatType,
      ),
    );
    const observation = latestObservations.get(contract.id) ?? null;
    const threshold = Number(contract.threshold);

    const modelProbability = projection
      ? probAtLeast(
          {
            distributionKind: projection.distributionKind,
            params: projection.params as Record<string, number>,
            pmf: (projection.pmf as number[] | null) ?? null,
          },
          threshold,
        )
      : null;

    const edge = computeEdge(
      {
        modelProbability,
        confidence: projection?.confidence ?? null,
        yesAskCents: observation?.yesAskCents ?? null,
        noAskCents: observation?.noAskCents ?? null,
      },
      thresholdPoints,
    );

    rows.push({
      contractId: contract.id,
      playerName: contract.player?.fullName ?? contract.kalshiPlayerName ?? "",
      gameLabel: `${game.awayTeam.nflverseAbbr} @ ${game.homeTeam.nflverseAbbr}`,
      statType: contract.statType as StatType,
      threshold,
      kickoffAt: game.kickoffAt.toISOString(),
      modelProbability,
      confidence: projection?.confidence ?? null,
      projectionComputedAt: projection?.computedAt.toISOString() ?? null,
      informationCutoff: projection?.informationCutoff.toISOString() ?? null,
      yesBidCents: observation?.yesBidCents ?? null,
      yesAskCents: observation?.yesAskCents ?? null,
      noBidCents: observation?.noBidCents ?? null,
      noAskCents: observation?.noAskCents ?? null,
      priceObservedAt: observation?.observedAt.toISOString() ?? null,
      side: edge.side,
      edgePoints: edge.edgePoints,
      confidenceAdjustedEdge: edge.confidenceAdjustedEdge,
      isRecommended: edge.isRecommended,
    });

    snapshotInputs.push({
      contractId: contract.id,
      projectionId: projection?.id ?? null,
      priceObservationId: observation?.id ?? null,
      side: edge.side,
      modelProbability,
      askCents:
        edge.side === "yes"
          ? (observation?.yesAskCents ?? null)
          : edge.side === "no"
            ? (observation?.noAskCents ?? null)
            : null,
      edgePoints: edge.edgePoints,
      confidenceAdjustedEdge: edge.confidenceAdjustedEdge,
      confidence: projection?.confidence ?? null,
      isRecommended: edge.isRecommended,
      thresholdPoints,
    });
  }

  // Row order: ranked rows first (deterministic tie-break), then rows with no
  // computable edge. Below-threshold rows stay in the response — filtering
  // them is the no-go the conventions call out.
  const withTickers = rows.map((row) => ({
    row,
    kalshiTicker:
      resolved.find((contract) => contract.id === row.contractId)
        ?.kalshiTicker ?? "",
  }));
  withTickers.sort((a, b) =>
    compareSlateRows(
      {
        edgePoints: a.row.edgePoints,
        confidenceAdjustedEdge: a.row.confidenceAdjustedEdge,
        kickoffAt: a.row.kickoffAt,
        kalshiTicker: a.kalshiTicker,
      },
      {
        edgePoints: b.row.edgePoints,
        confidenceAdjustedEdge: b.row.confidenceAdjustedEdge,
        kickoffAt: b.row.kickoffAt,
        kalshiTicker: b.kalshiTicker,
      },
    ),
  );
  const orderedRows = withTickers.map((entry) => entry.row);

  await persistSnapshotTransitions(snapshotInputs);

  // Admin decisions are attached AFTER ordering, by a code path the viewer
  // branch never enters.
  if (role === "admin") {
    const decisions = await prisma.decision.findMany({
      where: { contractId: { in: orderedRows.map((row) => row.contractId) } },
      orderBy: { decidedAt: "desc" },
      distinct: ["contractId"],
      select: { contractId: true, disposition: true, decidedAt: true },
    });
    const byContract = new Map(decisions.map((d) => [d.contractId, d]));
    for (const row of orderedRows) {
      const decision = byContract.get(row.contractId);
      if (decision) {
        row.currentDisposition = decision.disposition;
        row.decidedAt = decision.decidedAt.toISOString();
      }
    }
  }

  const unresolvedRows: UnresolvedRowDto[] = unresolvedContracts.map(
    (contract) => {
      const observation = latestObservations.get(contract.id) ?? null;
      const base: UnresolvedRowDto = {
        contractId: contract.id,
        title: contract.title,
        kalshiTicker: contract.kalshiTicker,
        yesAskCents: observation?.yesAskCents ?? null,
        priceObservedAt: observation?.observedAt.toISOString() ?? null,
      };
      if (role === "admin") {
        if (contract.resolutionNote)
          base.resolutionNote = contract.resolutionNote;
        if (contract.kalshiPlayerName)
          base.kalshiPlayerName = contract.kalshiPlayerName;
      }
      return base;
    },
  );

  const lastSync = await prisma.marketSyncRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { status: true, finishedAt: true },
  });

  const kickoffs = games
    .map((game) => game.kickoffAt)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    generatedAt: now.toISOString(),
    slateDate: kickoffs[0]?.toISOString() ?? null,
    gameCount: games.length,
    rows: orderedRows,
    unresolved: unresolvedRows,
    lastSync: lastSync
      ? {
          status: lastSync.status,
          finishedAt: lastSync.finishedAt?.toISOString() ?? null,
        }
      : null,
    degraded: lastSync?.status === "failed",
    nextKickoffAt: kickoffs[0]?.toISOString() ?? null,
  };
}

/** Contract detail: the slate row plus the projection's full reasoning. */
export async function readContractDetail(
  contractId: string,
  role: SlateRole,
): Promise<ContractDetailDto | null> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      kalshiTicker: true,
      title: true,
      kalshiPlayerName: true,
      playerId: true,
      gameId: true,
      statType: true,
      threshold: true,
      resolutionStatus: true,
      resolutionNote: true,
      status: true,
      player: { select: { fullName: true } },
      game: {
        select: {
          kickoffAt: true,
          homeTeam: { select: { nflverseAbbr: true } },
          awayTeam: { select: { nflverseAbbr: true } },
        },
      },
    },
  });
  if (!contract) return null;

  const observation =
    (await latestObservationByContract([contract.id])).get(contract.id) ?? null;

  const isResolved =
    (contract.resolutionStatus === "resolved" ||
      contract.resolutionStatus === "manual_override") &&
    contract.playerId !== null &&
    contract.gameId !== null &&
    contract.statType !== null &&
    contract.threshold !== null;

  const projection = isResolved
    ? ((
        await freshestProjections([
          {
            playerId: contract.playerId as string,
            gameId: contract.gameId as string,
            statType: contract.statType as StatType,
          },
        ])
      ).get(
        projectionKey(
          contract.playerId as string,
          contract.gameId as string,
          contract.statType as StatType,
        ),
      ) ?? null)
    : null;

  const drivers = projection
    ? (
        await prisma.projectionDriver.findMany({
          where: { projectionId: projection.id },
          orderBy: { rank: "asc" },
          select: { text: true },
        })
      ).map((driver) => driver.text)
    : [];

  const threshold =
    contract.threshold === null ? null : Number(contract.threshold);
  const modelProbability =
    projection && threshold !== null
      ? probAtLeast(
          {
            distributionKind: projection.distributionKind,
            params: projection.params as Record<string, number>,
            pmf: (projection.pmf as number[] | null) ?? null,
          },
          threshold,
        )
      : null;

  const edge = computeEdge(
    {
      modelProbability,
      confidence: projection?.confidence ?? null,
      yesAskCents: observation?.yesAskCents ?? null,
      noAskCents: observation?.noAskCents ?? null,
    },
    recommendationThresholdPoints(),
  );

  const midCents =
    observation?.yesBidCents != null && observation?.yesAskCents != null
      ? Math.round((observation.yesBidCents + observation.yesAskCents) / 2)
      : null;

  const detail: ContractDetailDto = {
    contractId: contract.id,
    playerName:
      contract.player?.fullName ?? contract.kalshiPlayerName ?? contract.title,
    gameLabel: contract.game
      ? `${contract.game.awayTeam.nflverseAbbr} @ ${contract.game.homeTeam.nflverseAbbr}`
      : null,
    statType: (contract.statType ?? "receiving_yards") as StatType,
    threshold: threshold ?? 0,
    kickoffAt: contract.game?.kickoffAt.toISOString() ?? "",
    modelProbability,
    confidence: projection?.confidence ?? null,
    projectionComputedAt: projection?.computedAt.toISOString() ?? null,
    informationCutoff: projection?.informationCutoff.toISOString() ?? null,
    yesBidCents: observation?.yesBidCents ?? null,
    yesAskCents: observation?.yesAskCents ?? null,
    noBidCents: observation?.noBidCents ?? null,
    noAskCents: observation?.noAskCents ?? null,
    priceObservedAt: observation?.observedAt.toISOString() ?? null,
    side: edge.side,
    edgePoints: edge.edgePoints,
    confidenceAdjustedEdge: edge.confidenceAdjustedEdge,
    isRecommended: edge.isRecommended,
    projectedValue: projection ? Number(projection.projectedValue) : null,
    projectedMedian: projection ? Number(projection.projectedMedian) : null,
    intervalLow: projection ? Number(projection.intervalLow) : null,
    intervalHigh: projection ? Number(projection.intervalHigh) : null,
    quantiles: projection
      ? (projection.quantiles as Record<string, number>)
      : null,
    drivers,
    modelVersion: projection?.modelVersion ?? null,
    midCents,
    status: contract.status,
  };

  if (role === "admin") {
    if (contract.resolutionNote) {
      detail.resolutionNote = contract.resolutionNote;
    }
    if (contract.kalshiPlayerName) {
      detail.kalshiPlayerName = contract.kalshiPlayerName;
    }
    const decision = await prisma.decision.findFirst({
      where: { contractId: contract.id },
      orderBy: { decidedAt: "desc" },
      select: { disposition: true, decidedAt: true },
    });
    if (decision) {
      detail.currentDisposition = decision.disposition;
      detail.decidedAt = decision.decidedAt.toISOString();
    }
  }

  return detail;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function projectionKey(
  playerId: string,
  gameId: string,
  statType: StatType,
): string {
  return `${playerId}:${gameId}:${statType}`;
}

type FreshProjection = {
  id: string;
  distributionKind: string;
  params: unknown;
  pmf: unknown;
  quantiles: unknown;
  projectedValue: Prisma.Decimal;
  projectedMedian: Prisma.Decimal;
  intervalLow: Prisma.Decimal;
  intervalHigh: Prisma.Decimal;
  confidence: Confidence;
  modelVersion: string;
  computedAt: Date;
  informationCutoff: Date;
};

/**
 * Freshest projection per (player, game, stat type) — greatest `computedAt`,
 * any model version. Fetched in one query and reduced in memory; a slate is
 * tens of keys, not thousands.
 */
async function freshestProjections(
  keys: Array<{ playerId: string; gameId: string; statType: StatType }>,
): Promise<
  Map<
    string,
    FreshProjection & { playerId: string; gameId: string; statType: StatType }
  >
> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.projection.findMany({
    where: {
      OR: keys.map((key) => ({
        playerId: key.playerId,
        gameId: key.gameId,
        statType: key.statType,
      })),
    },
    orderBy: { computedAt: "desc" },
    select: {
      id: true,
      playerId: true,
      gameId: true,
      statType: true,
      distributionKind: true,
      params: true,
      pmf: true,
      quantiles: true,
      projectedValue: true,
      projectedMedian: true,
      intervalLow: true,
      intervalHigh: true,
      confidence: true,
      modelVersion: true,
      computedAt: true,
      informationCutoff: true,
    },
  });
  const freshest = new Map<
    string,
    FreshProjection & { playerId: string; gameId: string; statType: StatType }
  >();
  for (const row of rows) {
    const key = projectionKey(row.playerId, row.gameId, row.statType);
    if (!freshest.has(key)) freshest.set(key, row);
  }
  return freshest;
}

type LatestObservation = {
  id: string;
  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
  observedAt: Date;
};

async function latestObservationByContract(
  contractIds: string[],
): Promise<Map<string, LatestObservation>> {
  if (contractIds.length === 0) return new Map();
  const observations = await prisma.priceObservation.findMany({
    where: { contractId: { in: contractIds } },
    orderBy: { observedAt: "desc" },
    distinct: ["contractId"],
    select: {
      id: true,
      contractId: true,
      yesBidCents: true,
      yesAskCents: true,
      noBidCents: true,
      noAskCents: true,
      observedAt: true,
    },
  });
  return new Map(
    observations.map((observation) => [observation.contractId, observation]),
  );
}

type SnapshotInput = {
  contractId: string;
  projectionId: string | null;
  priceObservationId: string | null;
  side: MarketSide | null;
  modelProbability: number | null;
  askCents: number | null;
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  confidence: Confidence | null;
  isRecommended: boolean;
  thresholdPoints: number;
};

/**
 * The RD-4 triggers: `appeared` when a contract first crosses into
 * recommended, `state_changed` when recommended flips off or the better side
 * flips. Unchanged states — including "still not recommended" — persist
 * nothing: routine refreshes must not write snapshot noise.
 *
 * The latest snapshot is re-read INSIDE the transaction so two concurrent
 * slate reads cannot both record the same transition.
 */
async function persistSnapshotTransitions(
  inputs: SnapshotInput[],
): Promise<void> {
  const candidates = inputs.filter(
    (input) => input.isRecommended || input.side !== null,
  );
  if (candidates.length === 0) return;

  await prisma.$transaction(async (tx) => {
    const latest = await tx.recommendationSnapshot.findMany({
      where: { contractId: { in: candidates.map((c) => c.contractId) } },
      orderBy: { createdAt: "desc" },
      distinct: ["contractId"],
      select: { contractId: true, isRecommended: true, side: true },
    });
    const latestByContract = new Map(latest.map((s) => [s.contractId, s]));

    for (const input of candidates) {
      const previous = latestByContract.get(input.contractId);
      let trigger: "appeared" | "state_changed" | null = null;
      if (!previous) {
        if (input.isRecommended) trigger = "appeared";
      } else if (previous.isRecommended !== input.isRecommended) {
        trigger = "state_changed";
      } else if (input.isRecommended && previous.side !== input.side) {
        trigger = "state_changed";
      }
      if (!trigger) continue;

      await tx.recommendationSnapshot.create({
        data: {
          contractId: input.contractId,
          projectionId: input.projectionId,
          priceObservationId: input.priceObservationId,
          side: input.side,
          modelProbability: input.modelProbability,
          askCents: input.askCents,
          edgePoints: input.edgePoints,
          confidenceAdjustedEdge: input.confidenceAdjustedEdge,
          confidence: input.confidence,
          isRecommended: input.isRecommended,
          thresholdPoints: input.thresholdPoints,
          trigger,
        },
      });
    }
  });
}

/** Exposed for the decisions ticket: one snapshot at decision time. */
export async function snapshotForDecision(
  tx: PrismaClient | Prisma.TransactionClient,
  input: Omit<SnapshotInput, "thresholdPoints">,
): Promise<void> {
  await tx.recommendationSnapshot.create({
    data: {
      ...input,
      thresholdPoints: recommendationThresholdPoints(),
      trigger: "decision",
    },
  });
}
