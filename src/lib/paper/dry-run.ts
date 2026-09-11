import "server-only";

import type { StatType } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  acceptedShadowProjectionIds,
  blockedSuggestionKeys,
} from "@/lib/suggestions/active-projection";
import { getOrderbookTop } from "@/lib/kalshi/client";
import { probAtLeast } from "@/lib/slate/probability";
import {
  inactivesLeadMinutes,
  latestFactKnownAtByGame,
} from "@/lib/slate/staleness-read";
import { evaluateStaleness } from "@/lib/slate/staleness";
import { planCycle, type CandidateInput, type CyclePlan } from "./plan";
import { activeRecalibration } from "./recalibration/store";
import { halts } from "./breakers";
import { readCampaignState } from "./state";

/**
 * Dry Run: the same decision path, rendered, writing nothing.
 *
 * It calls `planCycle` — the identical function the scheduled cycle calls, with
 * the identical active configuration, recalibration, bankroll state, caps and
 * fill policy. It then writes ONE `PaperDryRun` row and nothing else: no
 * position, no fill, no ledger entry, no breach, no desired-exposure record.
 *
 * That guarantee is structural rather than careful. `executeCycle` is the only
 * function in the codebase that turns a plan into ledger entries, and this
 * module does not call it. There is no dry-run flag threaded through the
 * writer that could be read backwards.
 *
 * A breaker that would block is reported explicitly rather than shown as an
 * empty candidate list — "nothing would happen" and "nothing would happen
 * because the bot is halted" are different answers.
 */

export type DryRunResult = {
  dryRunId: string;
  gameLabel: string;
  kickoffAt: string;
  ranAt: string;
  wouldExecute: boolean;
  blockedByBreaches: string[];
  plan: CyclePlan;
  slateCapacityCents: number;
};

export async function runDryRun(
  gameId: string,
  actorUserId: string,
  now: Date,
): Promise<DryRunResult> {
  const state = await readCampaignState();
  if (!state || !state.riskConfig) {
    throw new Error("No paper campaign configuration exists.");
  }

  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    select: {
      id: true,
      season: true,
      week: true,
      kickoffAt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { nflverseAbbr: true } },
      awayTeam: { select: { nflverseAbbr: true } },
    },
  });

  const stored = await prisma.paperBreach.findMany({
    where: { campaignId: state.campaignId, resolution: "active" },
    select: { condition: true },
  });
  const halting = [
    ...new Set(
      [
        ...stored.map((breach) => breach.condition),
        ...state.currentBreaches.map((breach) => breach.condition),
      ].filter(halts),
    ),
  ];

  const candidates = await buildCandidates(game, now);

  const plan = planCycle({
    now,
    kickoffAt: game.kickoffAt,
    config: {
      mode: state.riskConfig.mode,
      kellyFraction: state.riskConfig.kellyFraction,
      perGameCapPct: state.riskConfig.perGameCapPct,
      perSlateCapPct: state.riskConfig.perSlateCapPct,
      probabilityCeiling: state.riskConfig.probabilityCeiling,
    },
    recalibration: candidates.recalibration,
    activeBankrollCents: state.activeBankrollCents,
    availableBankrollCents: state.settledBalanceCents,
    slateExposureCents: state.openExposureCents,
    gameExposureCents: 0,
    heldByContractId: {},
    candidates: candidates.rows,
    haltingBreaches: halting,
    markToMarketUnavailable: !state.mark.available,
  });

  // PME-1: the PaperDryRun table was dropped. The preview CAPABILITY is retained
  // (planCycle above, the same function the scheduled cycle uses) but the
  // inspection record is no longer persisted. The route and screen removal, and
  // the reframing of this as a test-only utility, land in a later Pitch 11 ticket
  // (D7). `void actorUserId` keeps the signature stable for those callers.
  void actorUserId;

  return {
    dryRunId: `dry-run-${now.getTime()}`,
    gameLabel: `${game.awayTeam.nflverseAbbr} @ ${game.homeTeam.nflverseAbbr}`,
    kickoffAt: game.kickoffAt.toISOString(),
    ranAt: now.toISOString(),
    wouldExecute: plan.candidates.some((c) => c.filledContracts > 0),
    blockedByBreaches: halting,
    plan,
    slateCapacityCents: plan.slateCapacityCents,
  };
}

/**
 * Game windows a Dry Run can be pointed at: upcoming scheduled games that
 * actually have resolvable contracts. A window with nothing to price would
 * produce a legitimate empty result, but offering it as a choice would waste
 * the operator's time.
 */
export async function dryRunWindows(now: Date) {
  const games = await prisma.game.findMany({
    where: {
      status: "scheduled",
      kickoffAt: { gt: now },
      contracts: { some: { status: "active", resolutionStatus: "resolved" } },
    },
    orderBy: { kickoffAt: "asc" },
    take: 20,
    select: {
      id: true,
      kickoffAt: true,
      homeTeam: { select: { nflverseAbbr: true } },
      awayTeam: { select: { nflverseAbbr: true } },
    },
  });

  return games.map((game) => ({
    gameId: game.id,
    label: `${game.awayTeam.nflverseAbbr} @ ${game.homeTeam.nflverseAbbr}`,
    kickoffAt: game.kickoffAt.toISOString(),
  }));
}

/** Identical selection to the scheduled cycle's, so the two cannot diverge. */
async function buildCandidates(
  game: {
    id: string;
    season: number;
    homeTeamId: string;
    awayTeamId: string;
    kickoffAt: Date;
  },
  now: Date,
): Promise<{
  rows: CandidateInput[];
  recalibration: Awaited<ReturnType<typeof activeRecalibration>>;
}> {
  const contracts = await prisma.contract.findMany({
    where: {
      gameId: game.id,
      status: "active",
      resolutionStatus: "resolved",
      playerId: { not: null },
      statType: { not: null },
      threshold: { not: null },
    },
    select: {
      id: true,
      kalshiTicker: true,
      playerId: true,
      statType: true,
      threshold: true,
    },
  });
  if (contracts.length === 0) return { rows: [], recalibration: null };

  const projectionSelect = {
    id: true,
    playerId: true,
    statType: true,
    modelVersion: true,
    distributionKind: true,
    params: true,
    pmf: true,
    confidence: true,
    informationCutoff: true,
  } as const;
  const projections = await prisma.projection.findMany({
    where: {
      gameId: game.id,
      playerId: { in: contracts.map((c) => c.playerId as string) },
      // Mirror the live cycle: base is the default active projection; an
      // accepted shadow is overlaid below (RD-AS-3).
      provenance: "base",
    },
    orderBy: { computedAt: "desc" },
    select: projectionSelect,
  });
  const freshest = new Map<string, (typeof projections)[number]>();
  for (const projection of projections) {
    const key = `${projection.playerId}:${projection.statType}`;
    if (!freshest.has(key)) freshest.set(key, projection);
  }

  const keys = contracts.map((c) => ({
    playerId: c.playerId as string,
    gameId: game.id,
    statType: c.statType as StatType,
  }));
  const acceptedShadowIds = await acceptedShadowProjectionIds(keys);
  if (acceptedShadowIds.size > 0) {
    const shadows = await prisma.projection.findMany({
      where: { id: { in: [...acceptedShadowIds.values()] } },
      select: projectionSelect,
    });
    const shadowById = new Map(shadows.map((s) => [s.id, s]));
    for (const [key, shadowId] of acceptedShadowIds) {
      const [playerId, , statType] = key.split(":");
      const shadow = shadowById.get(shadowId);
      if (shadow) freshest.set(`${playerId}:${statType}`, shadow);
    }
  }
  const blockedKeys = await blockedSuggestionKeys(game.id);

  const observations = await prisma.priceObservation.findMany({
    where: { contractId: { in: contracts.map((c) => c.id) } },
    orderBy: { observedAt: "desc" },
    distinct: ["contractId"],
    select: { id: true, contractId: true },
  });
  const observationByContract = new Map(
    observations.map((o) => [o.contractId, o]),
  );

  const factKnownAt = await latestFactKnownAtByGame([game], now);
  const lead = inactivesLeadMinutes();
  const modelVersion = [...freshest.values()][0]?.modelVersion ?? null;
  const recalibration = modelVersion
    ? await activeRecalibration(modelVersion)
    : null;

  const rows: CandidateInput[] = [];
  for (const contract of contracts) {
    const projection = freshest.get(
      `${contract.playerId}:${contract.statType}`,
    );
    const observation = observationByContract.get(contract.id) ?? null;
    const book = await getOrderbookTop(contract.kalshiTicker);

    rows.push({
      contractId: contract.id,
      kalshiTicker: contract.kalshiTicker,
      projectionId: projection?.id ?? null,
      modelVersion: projection?.modelVersion ?? null,
      priceObservationId: observation?.id ?? null,
      rawYesProbability: projection
        ? probAtLeast(
            {
              distributionKind: projection.distributionKind,
              params: projection.params as Record<string, number>,
              pmf: (projection.pmf as number[] | null) ?? null,
            },
            Number(contract.threshold),
          )
        : null,
      confidence: projection?.confidence ?? null,
      staleness: projection
        ? evaluateStaleness(
            {
              kickoffAt: game.kickoffAt,
              informationCutoff: projection.informationCutoff,
              latestFactKnownAt: factKnownAt.get(game.id) ?? null,
              now,
            },
            lead,
          )
        : null,
      pendingSuggestion:
        blockedKeys.get(`${contract.playerId}:${contract.statType}`) ?? null,
      yesAskCents: book?.yesAskCents ?? null,
      noAskCents: book?.noAskCents ?? null,
      yesAskSizeContracts: book?.yesAskSizeContracts ?? null,
      noAskSizeContracts: book?.noAskSizeContracts ?? null,
    });
  }

  return { rows, recalibration };
}
