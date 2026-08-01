import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "../../../generated/prisma/client";
import type { StatType } from "../../../generated/prisma/enums";
import { FINAL_SNAPSHOT_WINDOW_MINUTES } from "@/lib/health/config";
import { computeEdge, recommendationThresholdPoints } from "@/lib/slate/edge";
import { probAtLeast } from "@/lib/slate/probability";
import {
  freshestProjections,
  latestObservationByContract,
  projectionKey,
} from "@/lib/slate/read";

/**
 * Final pre-kickoff snapshot capture (RD-19) — the comparison point Outcome
 * Scoring & Accuracy Surface will grade timing cost against. **Capture only**:
 * nothing here grades, scores, or interprets.
 *
 * Runs on the scheduled price path. Every resolved contract whose game kicks
 * off within `FINAL_SNAPSHOT_WINDOW_MINUTES` and has no `final_pre_kickoff`
 * snapshot gets exactly one, frozen from the freshest STORED projection and
 * price observation — a Kalshi outage at capture time therefore yields the
 * last observed book (older `priceObservationId`), not a fabricated null.
 *
 * Idempotence is the partial unique index
 * `recommendation_snapshots_final_one_per_contract`: a concurrent or repeated
 * invocation loses the insert race with a unique violation, which is counted
 * as "already captured", not an error.
 */
export async function captureFinalPreKickoffSnapshots(
  now: Date = new Date(),
): Promise<number> {
  const windowEnd = new Date(
    now.getTime() + FINAL_SNAPSHOT_WINDOW_MINUTES * 60 * 1000,
  );

  const games = await prisma.game.findMany({
    where: { status: "scheduled", kickoffAt: { gt: now, lte: windowEnd } },
    select: { id: true },
  });
  if (games.length === 0) return 0;

  const contracts = await prisma.contract.findMany({
    where: {
      status: "active",
      gameId: { in: games.map((game) => game.id) },
      resolutionStatus: { in: ["resolved", "manual_override"] },
      playerId: { not: null },
      statType: { not: null },
      threshold: { not: null },
      // The index enforces at-most-one; this filter keeps the routine pass
      // from re-attempting contracts already captured.
      snapshots: { none: { trigger: "final_pre_kickoff" } },
    },
    select: {
      id: true,
      playerId: true,
      gameId: true,
      statType: true,
      threshold: true,
    },
  });
  if (contracts.length === 0) return 0;

  const projections = await freshestProjections(
    contracts.map((contract) => ({
      playerId: contract.playerId as string,
      gameId: contract.gameId as string,
      statType: contract.statType as StatType,
    })),
  );
  const observations = await latestObservationByContract(
    contracts.map((contract) => contract.id),
  );
  const thresholdPoints = recommendationThresholdPoints();

  let captured = 0;
  for (const contract of contracts) {
    const projection = projections.get(
      projectionKey(
        contract.playerId as string,
        contract.gameId as string,
        contract.statType as StatType,
      ),
    );
    const observation = observations.get(contract.id) ?? null;
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

    try {
      await prisma.recommendationSnapshot.create({
        data: {
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
          trigger: "final_pre_kickoff",
        },
      });
      captured += 1;
    } catch (error) {
      // Losing the insert race to the partial unique index IS idempotence
      // working; anything else propagates.
      const uniqueViolation =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (!uniqueViolation) throw error;
    }
  }
  return captured;
}
