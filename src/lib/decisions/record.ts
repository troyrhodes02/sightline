import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "../../../generated/prisma/client";
import type { Disposition } from "../../../generated/prisma/enums";
import type { DecisionModel } from "../../../generated/prisma/models/Decision";
import { computeEdge, recommendationThresholdPoints } from "@/lib/slate/edge";
import { probAtLeast } from "@/lib/slate/probability";
import { snapshotForDecision } from "@/lib/slate/read";

type DecisionRow = Awaited<ReturnType<typeof createDecisionRow>>;

/** The game has started (or the market closed); decisions are closed. */
export class DecisionClosedError extends Error {
  constructor() {
    super("This game has started. Decisions are closed.");
    this.name = "DecisionClosedError";
  }
}

export class ContractNotFoundError extends Error {
  constructor() {
    super("No such contract.");
    this.name = "ContractNotFoundError";
  }
}

export type RecordDecisionInput = {
  contractId: string;
  disposition: Disposition;
  /** Always the session's user id — never a value from a request body. */
  userId: string;
};

export type RecordDecisionResult = {
  decision: DecisionRow;
  /** True when this decision superseded an earlier one on the contract. */
  superseded: boolean;
  /** True when the disposition matched the current one and nothing was written. */
  unchanged: boolean;
};

/**
 * Records the admin's disposition — the composable-transaction pattern from
 * CLAUDE.md: with no `tx`, this opens its own boundary; with one, it composes
 * into the caller's.
 *
 * **Append-only (RD-5).** A change creates a new row linked by
 * `supersedesDecisionId`; prior rows and their snapshots are never touched.
 * Re-recording the current disposition writes nothing. There is no un-mark.
 *
 * **Every snapshot value is read here, server-side** — the freshest stored
 * projection and observation at the moment of decision, never numbers the
 * browser rendered earlier and certainly never numbers it submitted.
 *
 * **Kickoff is the boundary (RD-6),** enforced against the game's scheduled
 * kickoff; an unresolved contract falls back to Kalshi's stated close time
 * when known and stays decidable otherwise.
 */
export async function recordDecision(
  input: RecordDecisionInput,
  tx?: Prisma.TransactionClient,
): Promise<RecordDecisionResult> {
  if (!tx) {
    return prisma.$transaction((client) => recordDecisionInner(input, client));
  }
  return recordDecisionInner(input, tx);
}

async function recordDecisionInner(
  input: RecordDecisionInput,
  tx: Prisma.TransactionClient,
): Promise<RecordDecisionResult> {
  const now = new Date();

  const contract = await tx.contract.findUnique({
    where: { id: input.contractId },
    select: {
      id: true,
      playerId: true,
      gameId: true,
      statType: true,
      threshold: true,
      closeTime: true,
      game: { select: { kickoffAt: true, status: true } },
    },
  });
  if (!contract) throw new ContractNotFoundError();

  if (contract.game) {
    if (
      contract.game.kickoffAt.getTime() <= now.getTime() ||
      contract.game.status !== "scheduled"
    ) {
      throw new DecisionClosedError();
    }
  } else if (
    contract.closeTime &&
    contract.closeTime.getTime() <= now.getTime()
  ) {
    throw new DecisionClosedError();
  }

  const previous = await tx.decision.findFirst({
    where: { contractId: contract.id },
    orderBy: { decidedAt: "desc" },
    select: { id: true, disposition: true },
  });

  if (previous?.disposition === input.disposition) {
    const decision = await tx.decision.findUniqueOrThrow({
      where: { id: previous.id },
    });
    return { decision, superseded: false, unchanged: true };
  }

  // The decision-time snapshot, read server-side from stored state.
  const projection =
    contract.playerId && contract.gameId && contract.statType
      ? await tx.projection.findFirst({
          where: {
            playerId: contract.playerId,
            gameId: contract.gameId,
            statType: contract.statType,
          },
          orderBy: { computedAt: "desc" },
          select: {
            id: true,
            distributionKind: true,
            params: true,
            pmf: true,
            confidence: true,
            computedAt: true,
            informationCutoff: true,
          },
        })
      : null;

  const observation = await tx.priceObservation.findFirst({
    where: { contractId: contract.id },
    orderBy: { observedAt: "desc" },
    select: {
      id: true,
      yesBidCents: true,
      yesAskCents: true,
      noBidCents: true,
      noAskCents: true,
      observedAt: true,
    },
  });

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

  const askCents =
    edge.side === "yes"
      ? (observation?.yesAskCents ?? null)
      : edge.side === "no"
        ? (observation?.noAskCents ?? null)
        : null;

  const decision = await createDecisionRow(tx, {
    contractId: contract.id,
    userId: input.userId,
    disposition: input.disposition,
    supersedesDecisionId: previous?.id ?? null,
    snapshotProjectionId: projection?.id ?? null,
    snapshotPriceObservationId: observation?.id ?? null,
    snapshotModelProbability: modelProbability,
    snapshotSide: edge.side,
    snapshotAskCents: askCents,
    snapshotEdgePoints: edge.edgePoints,
    snapshotConfidence: projection?.confidence ?? null,
    snapshotIsRecommended: edge.isRecommended,
    snapshotProjectionComputedAt: projection?.computedAt ?? null,
    snapshotInformationCutoff: projection?.informationCutoff ?? null,
    snapshotPriceObservedAt: observation?.observedAt ?? null,
  });

  // The decision-trigger snapshot (RD-4), in the same transaction: what
  // Sightline was recommending at the moment he decided.
  await snapshotForDecision(tx, {
    contractId: contract.id,
    projectionId: projection?.id ?? null,
    priceObservationId: observation?.id ?? null,
    side: edge.side,
    modelProbability,
    askCents,
    edgePoints: edge.edgePoints,
    confidenceAdjustedEdge: edge.confidenceAdjustedEdge,
    confidence: projection?.confidence ?? null,
    isRecommended: edge.isRecommended,
  });

  return { decision, superseded: previous !== null, unchanged: false };
}

function createDecisionRow(
  tx: Prisma.TransactionClient,
  data: Parameters<Prisma.TransactionClient["decision"]["create"]>[0]["data"],
) {
  return tx.decision.create({ data });
}

/** The DTO shape the route returns. */
export function toDecisionDto(decision: DecisionModel) {
  return {
    id: decision.id,
    contractId: decision.contractId,
    disposition: decision.disposition,
    decidedAt: decision.decidedAt.toISOString(),
    snapshotModelProbability:
      decision.snapshotModelProbability === null
        ? null
        : Number(decision.snapshotModelProbability),
    snapshotAskCents: decision.snapshotAskCents,
    snapshotEdgePoints:
      decision.snapshotEdgePoints === null
        ? null
        : Number(decision.snapshotEdgePoints),
    snapshotConfidence: decision.snapshotConfidence,
    snapshotIsRecommended: decision.snapshotIsRecommended,
    snapshotProjectionComputedAt:
      decision.snapshotProjectionComputedAt?.toISOString() ?? null,
    snapshotInformationCutoff:
      decision.snapshotInformationCutoff?.toISOString() ?? null,
    snapshotPriceObservedAt:
      decision.snapshotPriceObservedAt?.toISOString() ?? null,
  };
}
