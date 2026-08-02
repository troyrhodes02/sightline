import "server-only";

import { prisma } from "@/lib/prisma";
import type { GameStatus, StatType } from "../../../generated/prisma/enums";
import type { OutcomeBlockDto } from "@/lib/dto/slate";
import { recommendationGrade, sourcesDisagree } from "@/lib/accuracy/derive";

/**
 * The contract detail's outcome block — the SHARED portion only. This module
 * queries settlement, the official line, and grade rows; it deliberately
 * contains no query against the admin's private layer, so any viewer-reachable
 * payload built from it is structurally free of that data. The admin-only
 * line is attached by `readContractDetail`'s existing admin branch.
 *
 * Settlement (`Outcome`) and the official line (`PlayerGameStat`) are two
 * facts. Both render; a conflict is flagged with both values preserved,
 * never reconciled into one number.
 */

export type OutcomeBlockContext = {
  contractId: string;
  playerId: string | null;
  gameId: string | null;
  statType: StatType | null;
  threshold: number | null;
  gameStatus: GameStatus;
  /** The projection the detail view displays; its grade is preferred. */
  displayedProjectionId: string | null;
};

const STAT_COLUMN: Record<
  StatType,
  | "passingYards"
  | "rushingYards"
  | "receivingYards"
  | "receptions"
  | "rushingTds"
  | "receivingTds"
> = {
  passing_yards: "passingYards",
  rushing_yards: "rushingYards",
  receiving_yards: "receivingYards",
  receptions: "receptions",
  rushing_tds: "rushingTds",
  receiving_tds: "receivingTds",
};

/**
 * Builds the block for a contract whose game reached `completed` or
 * `cancelled` — the caller gates on that status, and pre-completion the block
 * is absent from the payload entirely.
 */
export async function readOutcomeBlock(
  context: OutcomeBlockContext,
): Promise<OutcomeBlockDto> {
  const resolved =
    context.playerId !== null &&
    context.gameId !== null &&
    context.statType !== null;

  const [outcome, finalSnapshot, thresholdGrade, stat, grades] =
    await Promise.all([
      prisma.outcome.findUnique({
        where: { contractId: context.contractId },
        select: { result: true, settledAt: true },
      }),
      prisma.recommendationSnapshot.findFirst({
        where: { contractId: context.contractId, trigger: "final_pre_kickoff" },
        select: { side: true },
      }),
      prisma.thresholdGrade.findFirst({
        where: { contractId: context.contractId },
        orderBy: { gradedAt: "desc" },
        select: { statedProbability: true, outcome: true },
      }),
      resolved
        ? prisma.playerGameStat.findUnique({
            where: {
              playerId_gameId: {
                playerId: context.playerId as string,
                gameId: context.gameId as string,
              },
            },
            select: {
              passingYards: true,
              rushingYards: true,
              receivingYards: true,
              receptions: true,
              rushingTds: true,
              receivingTds: true,
              corrections: {
                orderBy: { correctionKnownAt: "desc" },
                take: 1,
                select: { correctionKnownAt: true },
              },
            },
          })
        : null,
      resolved
        ? prisma.projectionGrade.findMany({
            where: {
              projection: {
                playerId: context.playerId as string,
                gameId: context.gameId as string,
                statType: context.statType as StatType,
              },
            },
            orderBy: { gradedAt: "desc" },
            select: { projectionId: true, status: true, officialValue: true },
          })
        : [],
    ]);

  // The official line is the world, not either source's claim about it: the
  // current corrected value from the stat row, with the grade's stored value
  // as fallback provenance when the row is unreachable.
  const grade =
    grades.find((g) => g.projectionId === context.displayedProjectionId) ??
    grades[0] ??
    null;
  const statValue =
    stat && context.statType !== null
      ? stat[STAT_COLUMN[context.statType]]
      : null;
  const officialValue =
    statValue !== null && statValue !== undefined
      ? Number(statValue)
      : grade !== null && grade.officialValue !== null
        ? Number(grade.officialValue)
        : null;

  const result = outcome?.result ?? null;

  // The projection grade line: stated probability and hit/miss from the
  // market threshold grade the Python job wrote for this exact contract; when
  // grading ran but the market threshold row has not been emitted yet, the
  // hit derives from the graded official value and the stated probability is
  // honestly absent rather than recomputed here.
  const projectionGrade =
    grade === null
      ? null
      : {
          status: grade.status,
          hit:
            thresholdGrade !== null
              ? thresholdGrade.outcome
              : grade.status === "graded" &&
                  officialValue !== null &&
                  context.threshold !== null
                ? officialValue > context.threshold
                : null,
          statedProbability:
            thresholdGrade === null
              ? null
              : Number(thresholdGrade.statedProbability),
        };

  return {
    officialValue,
    officialCorrectedAt:
      stat?.corrections[0]?.correctionKnownAt.toISOString() ?? null,
    settlement: outcome
      ? {
          result: outcome.result,
          settledAt: outcome.settledAt?.toISOString() ?? null,
        }
      : null,
    projectionGrade,
    recommendationGrade: recommendationGrade(finalSnapshot, result),
    sourcesDisagree: sourcesDisagree(thresholdGrade?.outcome ?? null, result),
  };
}
