import "server-only";

import { prisma } from "@/lib/prisma";
import { StatType } from "../../../generated/prisma/enums";
import type { OutcomeResult } from "../../../generated/prisma/enums";
import type { OverrideDecisionRowDto, OverridesDto } from "@/lib/dto/accuracy";
import {
  decisionOutcome,
  deriveDecisionTiming,
  sourcesDisagree,
  type FinalSnapshotFacts,
} from "./derive";

/**
 * The override-performance read — ADMIN ONLY, and structurally so: this module
 * is imported exclusively by the `/accuracy/overrides` page behind
 * `requireAdmin()`. It must never be imported from any viewer-reachable path;
 * the shared accuracy read stays decision-free.
 *
 * Everything derives at read time from stored facts — the acted-on decision's
 * own snapshot, the `final_pre_kickoff` snapshot, and the `Outcome` row.
 * Nothing here recomputes edge from current prices or projections, and
 * nothing is written back.
 *
 * The evaluative unit is the ACTED-ON decision: the head of each supersession
 * chain per contract per user (`supersededBy` is null). Superseded working
 * states appear nowhere; unmarked contracts (no row at all) appear nowhere.
 */

export type OverridesScope = OverridesDto["scope"];

const STAT_TYPES = new Set<string>(Object.values(StatType));

export type OverridesSearchParams = Record<
  string,
  string | string[] | undefined
>;

/**
 * Scope parsing for `/accuracy/overrides` query params — the URL is
 * user-editable input: unrecognized values fall back to that control's
 * default silently (spec §11). Seasons validate against seasons that actually
 * hold decisions, mirroring the accuracy page's values-with-data rule.
 */
export function parseOverridesScope(
  params: OverridesSearchParams,
  availableSeasons: number[],
): OverridesScope {
  const stat = first(params.stat);
  const season = first(params.season);
  const parsedSeason = season && /^\d{4}$/.test(season) ? Number(season) : null;
  return {
    statType: stat && STAT_TYPES.has(stat) ? (stat as StatType) : "all",
    season:
      parsedSeason !== null && availableSeasons.includes(parsedSeason)
        ? parsedSeason
        : "all",
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Seasons holding at least one decision — the season control's options. */
export async function decisionSeasons(): Promise<number[]> {
  const games = await prisma.game.findMany({
    where: { contracts: { some: { decisions: { some: {} } } } },
    select: { season: true },
    distinct: ["season"],
    orderBy: { season: "desc" },
  });
  return games.map((game) => game.season);
}

type PositionTally = {
  total: number;
  settled: number;
  won: number;
  lost: number;
  voided: number;
  pending: number;
};

type SkipTally = {
  total: number;
  settledYes: number;
  settledNo: number;
  voided: number;
  pending: number;
};

export async function readOverridePerformance(
  scope: OverridesScope,
): Promise<OverridesDto> {
  // The acted-on decision per contract per user: the row no other row
  // supersedes. Filtering here — not after the fact — is what keeps
  // superseded working states out of every figure on this surface.
  const decisions = await prisma.decision.findMany({
    where: {
      supersededBy: { is: null },
      contract: {
        ...(scope.statType !== "all" ? { statType: scope.statType } : {}),
        ...(scope.season !== "all" ? { game: { season: scope.season } } : {}),
      },
    },
    orderBy: { decidedAt: "desc" },
    select: {
      contractId: true,
      userId: true,
      disposition: true,
      decidedAt: true,
      snapshotSide: true,
      snapshotEdgePoints: true,
      snapshotModelProbability: true,
      priceObservation: {
        select: { yesAskCents: true, noAskCents: true },
      },
      contract: {
        select: {
          title: true,
          kalshiPlayerName: true,
          statType: true,
          threshold: true,
          player: { select: { fullName: true } },
          outcome: { select: { result: true } },
          snapshots: {
            where: { trigger: "final_pre_kickoff" },
            take: 1,
            select: {
              side: true,
              modelProbability: true,
              edgePoints: true,
              isRecommended: true,
              priceObservation: {
                select: { yesAskCents: true, noAskCents: true },
              },
            },
          },
          thresholdGrades: {
            where: { thresholdSource: "market" },
            orderBy: { gradedAt: "desc" },
            take: 1,
            select: { outcome: true },
          },
        },
      },
    },
  });

  // Defensive dedupe: one acted-on state per contract per user. The ordering
  // is decidedAt desc, so the first row seen for a key is the latest.
  const seen = new Set<string>();
  const actedOn = decisions.filter((decision) => {
    const key = `${decision.contractId}:${decision.userId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const took: PositionTally = {
    total: 0,
    settled: 0,
    won: 0,
    lost: 0,
    voided: 0,
    pending: 0,
  };
  const faded: PositionTally = { ...took };
  const skipped: SkipTally = {
    total: 0,
    settledYes: 0,
    settledNo: 0,
    voided: 0,
    pending: 0,
  };
  const agreement = {
    took: {
      recommended: { count: 0, won: 0 },
      notRecommended: { count: 0, won: 0 },
    },
    faded: {
      recommended: { count: 0, won: 0 },
      notRecommended: { count: 0, won: 0 },
    },
    skipped: {
      recommended: { count: 0, won: 0 },
      notRecommended: { count: 0, won: 0 },
    },
  };
  const timingCosts: number[] = [];
  const unavailableByReason = new Map<string, number>();
  let timingTotal = 0;
  const rows: OverrideDecisionRowDto[] = [];

  for (const decision of actedOn) {
    const contract = decision.contract;
    const finalSnapshot = contract.snapshots[0] ?? null;
    const final: FinalSnapshotFacts | null = finalSnapshot
      ? {
          side: finalSnapshot.side,
          modelProbability:
            finalSnapshot.modelProbability === null
              ? null
              : Number(finalSnapshot.modelProbability),
          edgePoints:
            finalSnapshot.edgePoints === null
              ? null
              : Number(finalSnapshot.edgePoints),
          yesAskCents: finalSnapshot.priceObservation?.yesAskCents ?? null,
          noAskCents: finalSnapshot.priceObservation?.noAskCents ?? null,
        }
      : null;
    const result: OutcomeResult | null = contract.outcome?.result ?? null;

    const timing = deriveDecisionTiming({
      disposition: decision.disposition,
      snapshotSide: decision.snapshotSide,
      snapshotEdgePoints:
        decision.snapshotEdgePoints === null
          ? null
          : Number(decision.snapshotEdgePoints),
      snapshotModelProbability:
        decision.snapshotModelProbability === null
          ? null
          : Number(decision.snapshotModelProbability),
      decisionYesAskCents: decision.priceObservation?.yesAskCents ?? null,
      decisionNoAskCents: decision.priceObservation?.noAskCents ?? null,
      final,
      outcomeResult: result,
    });

    const outcome = decisionOutcome(
      decision.disposition,
      decision.snapshotSide,
      result,
    );

    if (decision.disposition === "skipped") {
      tallySkip(skipped, outcome);
    } else {
      tallyPosition(decision.disposition === "took" ? took : faded, outcome);
    }

    // The agreement table needs a final pre-kickoff state to place the
    // decision against; a contract with no final snapshot has none and is
    // visible instead in the timing panel's unavailable count.
    if (finalSnapshot) {
      const cell = finalSnapshot.isRecommended
        ? agreement[decision.disposition].recommended
        : agreement[decision.disposition].notRecommended;
      cell.count += 1;
      if (outcome === "won") cell.won += 1;
    }

    // Skips are outside the timing denominator entirely — no action taken.
    if (decision.disposition !== "skipped") {
      timingTotal += 1;
      if (timing.timingCostPoints !== null) {
        timingCosts.push(timing.timingCostPoints);
      } else if (timing.timingUnavailableReason !== null) {
        unavailableByReason.set(
          timing.timingUnavailableReason,
          (unavailableByReason.get(timing.timingUnavailableReason) ?? 0) + 1,
        );
      }
    }

    rows.push({
      contractId: decision.contractId,
      decidedAt: decision.decidedAt.toISOString(),
      playerName:
        contract.player?.fullName ??
        contract.kalshiPlayerName ??
        contract.title,
      statType: contract.statType ?? "receiving_yards",
      threshold: contract.threshold === null ? 0 : Number(contract.threshold),
      disposition: decision.disposition,
      edgeAtDecision: timing.edgeAtDecision,
      edgeAtFinal: timing.edgeAtFinal,
      timingCostPoints: timing.timingCostPoints,
      timingUnavailableReason: timing.timingUnavailableReason,
      outcome,
      sourcesDisagree: sourcesDisagree(
        contract.thresholdGrades[0]?.outcome ?? null,
        result,
      ),
    });
  }

  return {
    scope,
    tiles: { took, faded, skipped },
    agreement: (["took", "faded", "skipped"] as const).map((disposition) => ({
      disposition,
      recommended: {
        count: agreement[disposition].recommended.count,
        won:
          disposition === "skipped"
            ? null
            : agreement[disposition].recommended.won,
      },
      notRecommended: {
        count: agreement[disposition].notRecommended.count,
        won:
          disposition === "skipped"
            ? null
            : agreement[disposition].notRecommended.won,
      },
    })),
    timing: {
      medianPoints: median(timingCosts),
      meanPoints: mean(timingCosts),
      measurable: timingCosts.length,
      total: timingTotal,
      unavailable: Array.from(unavailableByReason, ([reason, count]) => ({
        reason,
        count,
      })),
    },
    decisions: rows,
  };
}

/**
 * Took/faded accounting. Voided is never in the settled denominator. A
 * sideless take or fade settles descriptively (`settled_yes`/`settled_no`):
 * it counts as settled but grades neither won nor lost — the difference is
 * visible rather than fabricated.
 */
function tallyPosition(
  tile: PositionTally,
  outcome: OverrideDecisionRowDto["outcome"],
): void {
  tile.total += 1;
  switch (outcome) {
    case "won":
      tile.settled += 1;
      tile.won += 1;
      break;
    case "lost":
      tile.settled += 1;
      tile.lost += 1;
      break;
    case "settled_yes":
    case "settled_no":
      tile.settled += 1;
      break;
    case "voided":
      tile.voided += 1;
      break;
    case "pending":
      tile.pending += 1;
      break;
  }
}

/** Skip accounting: what settlement did, described — never won or lost. */
function tallySkip(
  tile: SkipTally,
  outcome: OverrideDecisionRowDto["outcome"],
): void {
  tile.total += 1;
  switch (outcome) {
    case "settled_yes":
      tile.settledYes += 1;
      break;
    case "settled_no":
      tile.settledNo += 1;
      break;
    case "voided":
      tile.voided += 1;
      break;
    case "pending":
      tile.pending += 1;
      break;
  }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
