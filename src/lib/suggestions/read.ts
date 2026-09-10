import "server-only";

import { prisma } from "@/lib/prisma";
import type { DataSource } from "../../../generated/prisma/enums";
import {
  assembleReliability,
  classifyAdjustment,
  type AdjustmentBreakdown,
  type SourceCounts,
  type SourceReliabilityDto,
} from "./reliability";

/**
 * Admin-only reads for the Suggestions surface (SIG-79). The reliability read is
 * the load-bearing one: Source Accuracy and Adjustment Accuracy are computed and
 * returned as two independent, independently-gated figures — there is no query,
 * aggregate, or field here that combines them.
 */

export type SuggestionListItem = {
  id: string;
  source: string;
  claimType: string;
  claimValue: string;
  subjectPlayerName: string;
  targetPlayerName: string;
  statType: string;
  status: string;
  evidenceText: string;
  reasonText: string;
  raisedAt: string;
  materialityKind: string;
  materialThresholdPp: number | null;
  materialRelativePct: number | null;
};

/** Every source that has produced a claim, so a zero-history source still shows. */
async function sourcesWithHistory(): Promise<string[]> {
  const rows = await prisma.adjustmentSourceEvent.findMany({
    distinct: ["source"],
    select: { source: true },
  });
  return rows.map((r) => r.source);
}

async function sourceCountsBySource(): Promise<Map<string, SourceCounts>> {
  const rows = await prisma.adjustmentSourceEvent.groupBy({
    by: ["source", "sourceOutcome"],
    where: { sourceOutcome: { not: null } },
    _count: { _all: true },
  });
  const out = new Map<string, SourceCounts>();
  for (const row of rows) {
    const entry = out.get(row.source) ?? { correct: 0, verifiable: 0 };
    const n = row._count._all;
    if (row.sourceOutcome === "correct") {
      entry.correct += n;
      entry.verifiable += n;
    } else if (row.sourceOutcome === "incorrect") {
      entry.verifiable += n;
    }
    // `unverifiable` is deliberately excluded from the denominator.
    out.set(row.source, entry);
  }
  return out;
}

async function adjustmentBreakdownBySource(): Promise<
  Map<string, AdjustmentBreakdown>
> {
  const rows = await prisma.adjustmentSuggestion.findMany({
    where: { shadowProjectionId: { not: null } },
    select: {
      sourceEvent: { select: { source: true } },
      baseProjection: { select: { grade: { select: { absErrorMean: true } } } },
      shadowProjection: {
        select: { grade: { select: { absErrorMean: true } } },
      },
    },
  });
  const out = new Map<string, AdjustmentBreakdown>();
  for (const row of rows) {
    const baseErr = row.baseProjection?.grade?.absErrorMean;
    const shadowErr = row.shadowProjection?.grade?.absErrorMean;
    // Gradable only when BOTH sides landed a graded error.
    if (baseErr == null || shadowErr == null) continue;
    const source = row.sourceEvent.source;
    const entry = out.get(source) ?? { improved: 0, hurt: 0, neutral: 0 };
    const verdict = classifyAdjustment(Number(baseErr), Number(shadowErr));
    entry[verdict] += 1;
    out.set(source, entry);
  }
  return out;
}

export async function readSuggestionReliability(): Promise<
  SourceReliabilityDto[]
> {
  const [sources, sourceCounts, breakdowns] = await Promise.all([
    sourcesWithHistory(),
    sourceCountsBySource(),
    adjustmentBreakdownBySource(),
  ]);
  return sources
    .sort()
    .map((source) =>
      assembleReliability(
        source,
        sourceCounts.get(source) ?? { correct: 0, verifiable: 0 },
        breakdowns.get(source) ?? { improved: 0, hurt: 0, neutral: 0 },
      ),
    );
}

function toListItem(row: {
  id: string;
  claimType: string;
  status: string;
  reasonText: string;
  createdAt: Date;
  materialityKind: string;
  materialThresholdPp: unknown;
  materialRelativePct: unknown;
  statType: string;
  targetPlayer: { fullName: string };
  sourceEvent: {
    source: string;
    claimValue: string;
    subjectPlayer: { fullName: string };
    raisedAt: Date;
    evidenceText: string;
  };
}): SuggestionListItem {
  return {
    id: row.id,
    source: row.sourceEvent.source,
    claimType: row.claimType,
    claimValue: row.sourceEvent.claimValue,
    subjectPlayerName: row.sourceEvent.subjectPlayer.fullName,
    targetPlayerName: row.targetPlayer.fullName,
    statType: row.statType,
    status: row.status,
    evidenceText: row.sourceEvent.evidenceText,
    reasonText: row.reasonText,
    raisedAt: row.sourceEvent.raisedAt.toISOString(),
    materialityKind: row.materialityKind,
    materialThresholdPp:
      row.materialThresholdPp == null ? null : Number(row.materialThresholdPp),
    materialRelativePct:
      row.materialRelativePct == null ? null : Number(row.materialRelativePct),
  };
}

const _LIST_SELECT = {
  id: true,
  claimType: true,
  status: true,
  reasonText: true,
  createdAt: true,
  materialityKind: true,
  materialThresholdPp: true,
  materialRelativePct: true,
  statType: true,
  targetPlayer: { select: { fullName: true } },
  sourceEvent: {
    select: {
      source: true,
      claimValue: true,
      raisedAt: true,
      evidenceText: true,
      subjectPlayer: { select: { fullName: true } },
    },
  },
} as const;

export async function readPendingSuggestions(): Promise<SuggestionListItem[]> {
  const rows = await prisma.adjustmentSuggestion.findMany({
    where: { status: { in: ["pending", "insufficient_evidence"] } },
    orderBy: { createdAt: "desc" },
    select: _LIST_SELECT,
  });
  return rows.map(toListItem);
}

export async function readSuggestionHistory(
  source?: string,
): Promise<SuggestionListItem[]> {
  const rows = await prisma.adjustmentSuggestion.findMany({
    where: source
      ? { sourceEvent: { is: { source: source as DataSource } } }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: _LIST_SELECT,
  });
  return rows.map(toListItem);
}
