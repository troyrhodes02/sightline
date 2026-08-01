import { serverEnv } from "@/env";
import type { Confidence, MarketSide } from "../../../generated/prisma/enums";

/**
 * Edge, side selection, confidence adjustment, and ordering — the read-time
 * arithmetic of the two-clock join. Nothing here is persisted as current
 * state; `RecommendationSnapshot` freezes copies at transitions and decisions.
 */

/**
 * Confidence weights for the slate's sort key (spec RD-11). One exported
 * constant so the number the slate ranks by and the number a snapshot freezes
 * can never drift apart.
 */
export const CONFIDENCE_WEIGHTS: Readonly<Record<Confidence, number>> = {
  high: 1.0,
  medium: 0.7,
  low: 0.4,
};

/** The configured recommendation threshold, in confidence-adjusted points. */
export function recommendationThresholdPoints(): number {
  return serverEnv().RECOMMENDATION_THRESHOLD_POINTS;
}

export type EdgeInputs = {
  /** P(stat >= threshold), 0..1, or null when no projection can price it. */
  modelProbability: number | null;
  confidence: Confidence | null;
  yesAskCents: number | null;
  noAskCents: number | null;
};

export type EdgeResult = {
  /** The side Sightline's probability favours at the executable ask (RD-1). */
  side: MarketSide | null;
  /** Model points minus the side's ask; positive means underpriced. */
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  isRecommended: boolean;
};

/**
 * Edge against the executable ask of the better side (RD-1).
 *
 * Both sides are evaluated — `yes` at `p×100 − yesAsk`, `no` at
 * `(1−p)×100 − noAsk` — and the greater executable edge wins. Confusing the
 * cost of one side with the implied probability of the other is the inverted-
 * edge trap the pitch names, which is why this is one function with one test
 * fixture rather than arithmetic inlined at call sites.
 *
 * Null propagates honestly: no probability, or no ask on either side, means
 * no edge — never zero.
 */
export function computeEdge(
  inputs: EdgeInputs,
  thresholdPoints: number,
): EdgeResult {
  const { modelProbability, confidence, yesAskCents, noAskCents } = inputs;

  if (modelProbability === null || confidence === null) {
    return {
      side: null,
      edgePoints: null,
      confidenceAdjustedEdge: null,
      isRecommended: false,
    };
  }

  const candidates: Array<{ side: MarketSide; edge: number }> = [];
  if (yesAskCents !== null) {
    candidates.push({
      side: "yes",
      edge: modelProbability * 100 - yesAskCents,
    });
  }
  if (noAskCents !== null) {
    candidates.push({
      side: "no",
      edge: (1 - modelProbability) * 100 - noAskCents,
    });
  }
  if (candidates.length === 0) {
    return {
      side: null,
      edgePoints: null,
      confidenceAdjustedEdge: null,
      isRecommended: false,
    };
  }

  candidates.sort((a, b) => b.edge - a.edge);
  const best = candidates[0];
  const edgePoints = round2(best.edge);
  const adjusted = round2(best.edge * CONFIDENCE_WEIGHTS[confidence]);

  return {
    side: best.side,
    edgePoints,
    confidenceAdjustedEdge: adjusted,
    isRecommended: adjusted >= thresholdPoints,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type RankableRow = {
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  kickoffAt: string;
  kalshiTicker: string;
};

/**
 * Deterministic slate order: confidence-adjusted edge desc, then raw edge
 * desc, then kickoff asc, then ticker asc. Rows with no computable edge rank
 * after every ranked row. Ties can never reshuffle between refreshes — the
 * final key is unique.
 */
export function compareSlateRows(a: RankableRow, b: RankableRow): number {
  const aHas = a.confidenceAdjustedEdge !== null;
  const bHas = b.confidenceAdjustedEdge !== null;
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas && bHas) {
    const byAdjusted =
      (b.confidenceAdjustedEdge as number) -
      (a.confidenceAdjustedEdge as number);
    if (byAdjusted !== 0) return byAdjusted;
    const byEdge = (b.edgePoints ?? 0) - (a.edgePoints ?? 0);
    if (byEdge !== 0) return byEdge;
  }
  if (a.kickoffAt !== b.kickoffAt) return a.kickoffAt < b.kickoffAt ? -1 : 1;
  return a.kalshiTicker < b.kalshiTicker ? -1 : 1;
}
