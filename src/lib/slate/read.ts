import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import type {
  Confidence,
  MarketSide,
  StatType,
} from "../../../generated/prisma/enums";
import type {
  ContractDetailDto,
  ProjectionState,
  SlateDto,
  SlateRowDto,
  UnresolvedRowDto,
} from "@/lib/dto/slate";
import {
  compareSlateRows,
  computeEdge,
  recommendationThresholdPoints,
} from "./edge";
import { decisionOutcome } from "@/lib/accuracy/derive";
import { readOutcomeBlock } from "./outcome-block";
import { probAtLeast } from "./probability";
import {
  acceptedShadowProjectionIds,
  projectionKey,
} from "@/lib/suggestions/active-projection";
import { formatAge } from "./staleness";
import { latestFactKnownAtByGame, stalenessForRow } from "./staleness-read";

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
      season: true,
      homeTeamId: true,
      awayTeamId: true,
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

  const resolvedKeys = resolved.map((contract) => ({
    playerId: contract.playerId as string,
    gameId: contract.gameId as string,
    statType: contract.statType as StatType,
  }));
  const [projections, declines] = await Promise.all([
    freshestProjections(resolvedKeys),
    insufficientEvidenceDeclines(resolvedKeys),
  ]);

  // One batched fact-recency read for every game on the slate (RD-22);
  // per-game scoping is inherent — each game gets only its own facts.
  const latestFacts = await latestFactKnownAtByGame(
    games.map((game) => ({
      id: game.id,
      season: game.season,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
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
    const key = projectionKey(
      contract.playerId as string,
      contract.gameId as string,
      contract.statType as StatType,
    );
    const { state: projectionState } = resolveProjectionState(
      projection !== undefined,
      declines.get(key),
    );

    const modelProbability = projection
      ? probAtLeast(
          {
            distributionKind: projection.distributionKind,
            params: projection.params as Record<string, number>,
            pmf: (projection.pmf as number[] | null) ?? null,
            quantiles:
              (projection.quantiles as Record<string, number> | null) ?? null,
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
      staleness: stalenessForRow({
        kickoffAt: game.kickoffAt,
        informationCutoff: projection?.informationCutoff ?? null,
        latestFactKnownAt: latestFacts.get(game.id) ?? null,
        now,
      }),
      projectionAge: projection
        ? formatAge(projection.computedAt.toISOString(), now)
        : null,
      yesBidCents: observation?.yesBidCents ?? null,
      yesAskCents: observation?.yesAskCents ?? null,
      noBidCents: observation?.noBidCents ?? null,
      noAskCents: observation?.noAskCents ?? null,
      priceObservedAt: observation?.observedAt.toISOString() ?? null,
      priceAge: observation
        ? formatAge(observation.observedAt.toISOString(), now)
        : null,
      side: edge.side,
      edgePoints: edge.edgePoints,
      confidenceAdjustedEdge: edge.confidenceAdjustedEdge,
      isRecommended: edge.isRecommended,
      modelVersion: projection?.modelVersion ?? null,
      projectionState,
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
          id: true,
          kickoffAt: true,
          season: true,
          status: true,
          homeTeamId: true,
          awayTeamId: true,
          homeTeam: { select: { nflverseAbbr: true } },
          awayTeam: { select: { nflverseAbbr: true } },
        },
      },
    },
  });
  if (!contract) return null;
  const now = new Date();

  const observation =
    (await latestObservationByContract([contract.id])).get(contract.id) ?? null;

  const isResolved =
    (contract.resolutionStatus === "resolved" ||
      contract.resolutionStatus === "manual_override") &&
    contract.playerId !== null &&
    contract.gameId !== null &&
    contract.statType !== null &&
    contract.threshold !== null;

  const detailKey = isResolved
    ? [
        {
          playerId: contract.playerId as string,
          gameId: contract.gameId as string,
          statType: contract.statType as StatType,
        },
      ]
    : [];
  const [detailProjections, detailDeclines] = await Promise.all([
    freshestProjections(detailKey),
    insufficientEvidenceDeclines(detailKey),
  ]);
  const projection = isResolved
    ? (detailProjections.get(
        projectionKey(
          contract.playerId as string,
          contract.gameId as string,
          contract.statType as StatType,
        ),
      ) ?? null)
    : null;
  const detailDeclineReason = isResolved
    ? (detailDeclines.get(
        projectionKey(
          contract.playerId as string,
          contract.gameId as string,
          contract.statType as StatType,
        ),
      ) ?? undefined)
    : undefined;
  const { state: detailProjectionState, declineReason } =
    resolveProjectionState(projection !== null, detailDeclineReason);

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
            quantiles:
              (projection.quantiles as Record<string, number> | null) ?? null,
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

  // Same derivation the slate used — the two surfaces can never disagree,
  // because neither computes staleness locally (RD-28).
  const latestFactKnownAt = contract.game
    ? ((
        await latestFactKnownAtByGame([
          {
            id: contract.game.id,
            season: contract.game.season,
            homeTeamId: contract.game.homeTeamId,
            awayTeamId: contract.game.awayTeamId,
          },
        ])
      ).get(contract.game.id) ?? null)
    : null;
  const staleness = contract.game
    ? stalenessForRow({
        kickoffAt: contract.game.kickoffAt,
        informationCutoff: projection?.informationCutoff ?? null,
        latestFactKnownAt,
        now,
      })
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
    staleness,
    projectionAge: projection
      ? formatAge(projection.computedAt.toISOString(), now)
      : null,
    yesBidCents: observation?.yesBidCents ?? null,
    yesAskCents: observation?.yesAskCents ?? null,
    noBidCents: observation?.noBidCents ?? null,
    noAskCents: observation?.noAskCents ?? null,
    priceObservedAt: observation?.observedAt.toISOString() ?? null,
    priceAge: observation
      ? formatAge(observation.observedAt.toISOString(), now)
      : null,
    side: edge.side,
    edgePoints: edge.edgePoints,
    confidenceAdjustedEdge: edge.confidenceAdjustedEdge,
    isRecommended: edge.isRecommended,
    modelVersion: projection?.modelVersion ?? null,
    projectionState: detailProjectionState,
    projectedValue: projection ? Number(projection.projectedValue) : null,
    projectedMedian: projection ? Number(projection.projectedMedian) : null,
    intervalLow: projection ? Number(projection.intervalLow) : null,
    intervalHigh: projection ? Number(projection.intervalHigh) : null,
    quantiles: projection
      ? (projection.quantiles as Record<string, number>)
      : null,
    pmf: projection ? ((projection.pmf as number[] | null) ?? null) : null,
    distributionKind: projection?.distributionKind ?? null,
    drivers,
    midCents,
    status: contract.status,
    declineReason,
  };

  // The outcome block exists only once the game is completed (or cancelled,
  // surfacing the taxonomy state) — absence IS the pre-outcome state. The
  // shared block carries no decision data; see outcome-block.ts.
  if (
    contract.game &&
    (contract.game.status === "completed" ||
      contract.game.status === "cancelled")
  ) {
    detail.outcomeBlock = await readOutcomeBlock({
      contractId: contract.id,
      playerId: contract.playerId,
      gameId: contract.gameId,
      statType: contract.statType,
      threshold,
      gameStatus: contract.game.status,
      displayedProjectionId: projection?.id ?? null,
    });
  }

  if (role === "admin") {
    if (contract.resolutionNote) {
      detail.resolutionNote = contract.resolutionNote;
    }
    if (contract.kalshiPlayerName) {
      detail.kalshiPlayerName = contract.kalshiPlayerName;
    }
    // The acted-on decision: the head of the supersession chain.
    const decision = await prisma.decision.findFirst({
      where: { contractId: contract.id, supersededBy: { is: null } },
      orderBy: { decidedAt: "desc" },
      select: { disposition: true, decidedAt: true, snapshotSide: true },
    });
    if (decision) {
      detail.currentDisposition = decision.disposition;
      detail.decidedAt = decision.decidedAt.toISOString();
      if (detail.outcomeBlock) {
        detail.outcomeBlock.decision = {
          disposition: decision.disposition,
          outcome: decisionOutcome(
            decision.disposition,
            decision.snapshotSide,
            detail.outcomeBlock.settlement?.result ?? null,
          ),
        };
      }
    }
  }

  return detail;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

// Single source for the (player, game, stat) key, imported from the active-
// projection resolver so the freshest-base map and the accepted-shadow overlay
// can never key differently (review audit: was duplicated byte-for-byte here).
// Re-exported for existing importers (e.g. final-snapshot).
export { projectionKey };

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
 * The active model version per stat type, from `ModelSelection`. One read per
 * request (six rows), cached on the request via React `cache`. A stat type
 * absent from the table has no active model and therefore no projection is
 * selected for it — the seed migration ships all six, so the map is complete in
 * practice, but the read never assumes so.
 */
export const modelSelectionMap = cache(
  async (): Promise<Map<StatType, string>> => {
    const rows = await prisma.modelSelection.findMany({
      select: { statType: true, modelVersion: true },
    });
    return new Map(rows.map((row) => [row.statType, row.modelVersion]));
  },
);

/**
 * Freshest projection per (player, game, stat type) whose `modelVersion` equals
 * the ACTIVE model for that stat type (RD-1 / spec §freshest projection) —
 * greatest `computedAt` among those. Model selection is per stat type, so two
 * contracts on one slate may be priced by different models; a projection from
 * an inactive model is never shown. Fetched in one query and reduced in memory;
 * a slate is tens of keys, not thousands.
 */
export async function freshestProjections(
  keys: Array<{ playerId: string; gameId: string; statType: StatType }>,
): Promise<
  Map<
    string,
    FreshProjection & { playerId: string; gameId: string; statType: StatType }
  >
> {
  if (keys.length === 0) return new Map();
  const activeByStat = await modelSelectionMap();
  const projectionSelect = {
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
  } as const;
  const rows = await prisma.projection.findMany({
    where: {
      // A stored adjustment shadow is never active merely by existing
      // (RD-AS-3): the freshest BASE is the default; an accepted shadow is
      // overlaid below.
      provenance: "base",
      OR: keys.map((key) => ({
        playerId: key.playerId,
        gameId: key.gameId,
        statType: key.statType,
      })),
    },
    orderBy: { computedAt: "desc" },
    select: projectionSelect,
  });
  const freshest = new Map<
    string,
    FreshProjection & { playerId: string; gameId: string; statType: StatType }
  >();
  for (const row of rows) {
    const active = activeByStat.get(row.statType);
    // Only the active model's projections are eligible. A projection from an
    // inactive model version is never the freshest even if it is more recent.
    if (active === undefined || row.modelVersion !== active) continue;
    const key = projectionKey(row.playerId, row.gameId, row.statType);
    if (!freshest.has(key)) freshest.set(key, row);
  }

  // An ACCEPTED suggestion's shadow becomes the active projection for its key,
  // bypassing the active-model filter (acceptance makes it active by fiat, and
  // a shadow is always a simulation projection whatever the base's model was).
  const acceptedShadowIds = await acceptedShadowProjectionIds(keys);
  if (acceptedShadowIds.size > 0) {
    const shadows = await prisma.projection.findMany({
      where: { id: { in: [...acceptedShadowIds.values()] } },
      select: projectionSelect,
    });
    const shadowById = new Map(shadows.map((s) => [s.id, s]));
    for (const [key, shadowId] of acceptedShadowIds) {
      const shadow = shadowById.get(shadowId);
      if (shadow) freshest.set(key, shadow);
    }
  }
  return freshest;
}

/**
 * Which (player, game, stat) keys carry a persisted `insufficient_evidence`
 * decline for their ACTIVE model version (RD-4). Read alongside
 * `freshestProjections`: a key with neither a projection nor a decline is
 * `none`; a key with a decline (and no active-model projection) is
 * `insufficient_evidence`. One batched query for the whole slate.
 */
export async function insufficientEvidenceDeclines(
  keys: Array<{ playerId: string; gameId: string; statType: StatType }>,
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const activeByStat = await modelSelectionMap();
  const rows = await prisma.projectionDecline.findMany({
    where: {
      reason: "insufficient_evidence",
      OR: keys.map((key) => ({
        playerId: key.playerId,
        gameId: key.gameId,
        statType: key.statType,
      })),
    },
    orderBy: { computedAt: "desc" },
    select: {
      playerId: true,
      gameId: true,
      statType: true,
      modelVersion: true,
    },
  });
  const byKey = new Map<string, string>();
  for (const row of rows) {
    if (activeByStat.get(row.statType) !== row.modelVersion) continue;
    const key = projectionKey(row.playerId, row.gameId, row.statType);
    if (!byKey.has(key))
      byKey.set(key, DECLINE_REASON_TEXT.insufficient_evidence);
  }
  return byKey;
}

/** Plain-English decline copy — never the raw enum, never a model internal. */
const DECLINE_REASON_TEXT: Record<string, string> = {
  insufficient_evidence:
    "Sightline has no relevant history for this player in this role as of the information cutoff, so the active model declined to project rather than fabricate a distribution.",
};

/**
 * Resolve the projection state for one key given the freshest active-model
 * projection and the decline map. `projected` when a projection exists,
 * `insufficient_evidence` when a decline exists, `none` otherwise.
 */
function resolveProjectionState(
  hasProjection: boolean,
  declineReason: string | undefined,
): { state: ProjectionState; declineReason: string | null } {
  if (hasProjection) return { state: "projected", declineReason: null };
  if (declineReason !== undefined)
    return { state: "insufficient_evidence", declineReason };
  return { state: "none", declineReason: null };
}

type LatestObservation = {
  id: string;
  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
  observedAt: Date;
};

export async function latestObservationByContract(
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
 * Every resolved row is a candidate: a contract whose inputs VANISHED (no
 * side, not recommended) must still record the transition off recommended,
 * or Pitch 6 would grade against a stale "recommended" as the last known
 * state. The transition check itself decides whether anything is written.
 *
 * The latest snapshot is re-read inside the transaction, which narrows —
 * but at READ COMMITTED does not eliminate — the window in which two
 * concurrent slate reads record the same transition twice. A duplicate is
 * identical noise, not corruption: grading reads latest-per-contract, and
 * at three users the window is acceptable.
 */
async function persistSnapshotTransitions(
  inputs: SnapshotInput[],
): Promise<void> {
  const candidates = inputs;
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
