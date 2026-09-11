import "server-only";

import { z } from "zod";
import type { StatType } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  KalshiRateLimitError,
  KalshiUnavailableError,
  getOrderbookTop,
} from "@/lib/kalshi/client";
import { probAtLeast } from "@/lib/slate/probability";
import {
  inactivesLeadMinutes,
  latestFactKnownAtByGame,
} from "@/lib/slate/staleness-read";
import { evaluateStaleness } from "@/lib/slate/staleness";
import { ACCOUNT_TIMEZONE, EXECUTION_WINDOW_HOURS } from "@/lib/paper/config";
import {
  accountLocalDate,
  decidePaperCycleAction,
  gameWindowKey,
} from "@/lib/paper/cadence";
import {
  bidOnHeldSide,
  drawdownBps,
  markToMarket,
  openExposureCents,
  type OpenPositionMark,
} from "@/lib/paper/bankroll";
import { evaluateBreakers, halts } from "@/lib/paper/breakers";
import { planCycle, type CandidateInput } from "@/lib/paper/plan";
import { executeCycle } from "@/lib/paper/execute";
import { activeRecalibration } from "@/lib/paper/recalibration/store";
import { capacityCents } from "@/lib/paper/plan";
import { calibrationSample } from "@/lib/paper/calibration-window";
import {
  acceptedShadowProjectionIds,
  blockedSuggestionKeys,
} from "@/lib/suggestions/active-projection";
import {
  resolvePortfolios,
  type PortfolioTarget,
} from "@/lib/paper/portfolios";

/**
 * The scheduled autonomous paper cycle.
 *
 * The cron calls this unconditionally every ten minutes; the ROUTE decides —
 * from stored schedule and stored campaign state, never the calendar — whether
 * anything happens. Same shape as the price-refresh path, deliberately: one
 * cadence pattern in this codebase rather than two.
 *
 * A Kalshi outage is a designed degraded state, answered 200 with
 * `degraded: true` and recorded as a failed cycle. It is never a 5xx and it
 * never creates a position.
 */

export const paperCycleInputSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
  })
  .strict();

export type PipelinePaperCycleInput = z.infer<typeof paperCycleInputSchema>;

export type PipelinePaperCycleResult = {
  skipped?: "not_expected" | "disabled" | "killed" | "coalesced";
  windowsEvaluated: number;
  cycles: Array<{
    cycleId: string | null;
    gameId: string;
    outcome: string;
    skipReason: string | null;
    candidatesEvaluated: number;
    candidatesFilled: number;
    stakedCents: number;
  }>;
  degraded: boolean;
};

export async function runPaperCycle(
  input: PipelinePaperCycleInput,
  now: Date = new Date(),
): Promise<PipelinePaperCycleResult> {
  const empty = (
    skipped: PipelinePaperCycleResult["skipped"],
  ): PipelinePaperCycleResult => ({
    skipped,
    windowsEvaluated: 0,
    cycles: [],
    degraded: false,
  });

  // One evaluation campaign owns up to three portfolios (PME-5). The kill
  // switch and starting bankroll live on the parent; per-portfolio bankroll,
  // ledger, and history live on each `PaperCampaign` child.
  const evaluationCampaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: { id: true, killSwitchEngaged: true },
  });
  // Never set up is dormancy, not failure, and writes no run row — the same
  // posture as an offseason price refresh.
  if (!evaluationCampaign) return empty("not_expected");

  // Baseline + simulation always; hybrid only when the selection is mixed.
  // Provisioned idempotently here so a portfolio added mid-season begins
  // accumulating on the next tick without a manual step.
  const portfolios = await resolvePortfolios(evaluationCampaign.id);

  const windowOpensAt = new Date(
    now.getTime() + EXECUTION_WINDOW_HOURS * 60 * 60 * 1000,
  );
  const games = await prisma.game.findMany({
    where: {
      status: "scheduled",
      kickoffAt: { gte: now, lte: windowOpensAt },
      contracts: { some: { status: "active" } },
    },
    select: {
      id: true,
      season: true,
      kickoffAt: true,
      homeTeamId: true,
      awayTeamId: true,
    },
    orderBy: { kickoffAt: "asc" },
  });
  if (games.length === 0) return empty("not_expected");

  // Killed and disabled DO record a run: the operator needs to see that the
  // scheduler is alive while the bot is deliberately off, which is a different
  // fact from the scheduler having stopped.
  const runId = await startRun(input.invocationId, now);
  if (runId === null) return empty("coalesced");

  // The kill switch is campaign-wide (parent flag): it stops NEW positions
  // across every portfolio. A per-portfolio breach halts one portfolio only and
  // is handled inside the plan via halting breaches, not here.
  if (evaluationCampaign.killSwitchEngaged) {
    await finishRun(runId, "succeeded", null);
    return { ...empty("killed"), windowsEvaluated: games.length };
  }
  // Autonomy is per portfolio. When no portfolio is enabled the whole campaign
  // is dormant; a subset being enabled is normal (a newly-provisioned sibling
  // defaults off until the operator turns it on).
  if (!portfolios.some((p) => p.autonomyEnabled)) {
    await finishRun(runId, "succeeded", null);
    return { ...empty("disabled"), windowsEvaluated: games.length };
  }

  const result: PipelinePaperCycleResult = {
    windowsEvaluated: 0,
    cycles: [],
    degraded: false,
  };
  let failed = false;

  // The loop runs inside try/catch so the run row is ALWAYS closed out. An
  // unexpected throw — a check-constraint violation, a Prisma validation error,
  // anything that is not a Kalshi outage — used to escape before `finishRun`,
  // leaving the row stuck in `running` forever. `readHealth` selects the
  // paper-cycle signal by `status: "succeeded"`, so a stranded row makes the
  // health surface keep reporting the last good run's timestamp while nothing
  // is actually running: the exact failure the health surface exists to expose,
  // hidden by the surface itself.
  //
  // The error is re-thrown after the row is closed, deliberately. A Kalshi
  // outage is a 200 with `degraded: true` because it is expected weather; a
  // constraint violation is a bug and should be a red Actions run and a 500.
  // Games later in the list go unevaluated, which the ten-minute cadence
  // recovers from on the next tick.
  try {
    // Every portfolio evaluates every eligible window independently. A portfolio
    // that is disabled, or has no risk config yet, is skipped without stopping
    // its siblings — the three ledgers never merge and never depend on one
    // another. The invocationId is namespaced per portfolio so each portfolio's
    // idempotency key is distinct on the (campaignId, gameId, invocationId)
    // unique index, and a coalesce on one portfolio never suppresses another.
    for (const portfolio of portfolios) {
      if (!portfolio.autonomyEnabled) continue;

      const config = await prisma.paperRiskConfig.findFirst({
        where: { campaignId: portfolio.campaignId },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!config) continue;

      const portfolioInvocationId = `${input.invocationId}:${portfolio.portfolio}`;

      for (const game of games) {
        const lastCycle = await prisma.paperCycle.findFirst({
          where: { campaignId: portfolio.campaignId, gameId: game.id },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });
        const action = decidePaperCycleAction({
          kickoffAt: game.kickoffAt,
          lastCycleStartedAt: lastCycle?.startedAt ?? null,
          now,
        });
        if (action === "not_in_window" || action === "coalesced") continue;

        result.windowsEvaluated += 1;
        const startedAt = new Date();

        try {
          const cycle = await evaluateOneGame({
            campaign: {
              id: portfolio.campaignId,
              startingBankrollCents: portfolio.startingBankrollCents,
              highWaterMarkCents: portfolio.highWaterMarkCents,
            },
            portfolio,
            config,
            game,
            now,
            invocationId: portfolioInvocationId,
            pipelineRunId: runId,
            startedAt,
          });
          result.cycles.push(cycle);
          if (cycle.outcome === "failed") failed = true;
        } catch (error) {
          const degraded =
            error instanceof KalshiUnavailableError ||
            error instanceof KalshiRateLimitError;
          if (!degraded) throw error;
          result.degraded = true;
          failed = true;
          result.cycles.push({
            cycleId: null,
            gameId: game.id,
            outcome: "failed",
            // The client's message is already sanitized: no URL, no header, no key.
            skipReason: (error as Error).message,
            candidatesEvaluated: 0,
            candidatesFilled: 0,
            stakedCents: 0,
          });
        }
      }
    }
  } catch (error) {
    await finishRun(
      runId,
      "failed",
      "the cycle run stopped on an unexpected error",
    );
    throw error;
  }

  await finishRun(
    runId,
    failed ? "failed" : "succeeded",
    failed ? "one or more game windows could not be evaluated" : null,
  );
  return result;
}

async function evaluateOneGame(args: {
  campaign: {
    id: string;
    startingBankrollCents: number;
    highWaterMarkCents: number;
  };
  /** Which portfolio this cycle belongs to; supplies the per-stat model choice. */
  portfolio: PortfolioTarget;
  config: {
    id: string;
    mode: "conservative" | "moderate" | "aggressive" | "custom";
    kellyFraction: unknown;
    perGameCapPct: number;
    perSlateCapPct: number;
    drawdownWarnPct: number;
    drawdownHaltPct: number;
    probabilityCeiling: unknown;
  };
  game: {
    id: string;
    season: number;
    kickoffAt: Date;
    homeTeamId: string;
    awayTeamId: string;
  };
  now: Date;
  invocationId: string;
  pipelineRunId: string;
  startedAt: Date;
}): Promise<PipelinePaperCycleResult["cycles"][number]> {
  const { campaign, portfolio, config, game, now } = args;

  // --- Bankroll and exposure, as they are right now -----------------------

  const lastEntry = await prisma.paperLedgerEntry.findFirst({
    where: { campaignId: campaign.id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { balanceAfterCents: true },
  });
  const settledBalanceCents = lastEntry?.balanceAfterCents ?? 0;

  const openPositions = await prisma.paperPosition.findMany({
    where: { campaignId: campaign.id, status: "open" },
    select: {
      id: true,
      contractId: true,
      side: true,
      contracts: true,
      costBasisCents: true,
      feesPaidCents: true,
      contract: { select: { gameId: true } },
    },
  });

  const observations = await prisma.priceObservation.findMany({
    where: { contractId: { in: openPositions.map((p) => p.contractId) } },
    orderBy: { observedAt: "desc" },
    distinct: ["contractId"],
    select: { contractId: true, yesBidCents: true, noBidCents: true },
  });
  const bidByContract = new Map(observations.map((o) => [o.contractId, o]));

  const marks: OpenPositionMark[] = openPositions.map((position) => ({
    positionId: position.id,
    side: position.side,
    contracts: position.contracts,
    costBasisCents: position.costBasisCents,
    feesPaidCents: position.feesPaidCents,
    bidCentsOnHeldSide: bidOnHeldSide(
      position.side,
      bidByContract.get(position.contractId) ?? null,
    ),
  }));

  const mark = markToMarket(settledBalanceCents, marks);
  const activeBankrollCents = mark.available
    ? mark.markCents
    : settledBalanceCents;
  const slateExposureCents = openExposureCents(openPositions);
  const gameExposureCents = openExposureCents(
    openPositions.filter((p) => p.contract.gameId === game.id),
  );

  // --- Breakers ------------------------------------------------------------

  const calibration = await calibrationSample();
  const breaches = evaluateBreakers({
    mode: config.mode,
    drawdownWarnPct: config.drawdownWarnPct,
    drawdownHaltPct: config.drawdownHaltPct,
    drawdownBps: drawdownBps(campaign.highWaterMarkCents, mark),
    openExposureCents: slateExposureCents,
    slateCapacityCents: capacityCents(
      activeBankrollCents,
      config.perSlateCapPct,
    ),
    calibration,
    killSwitchEngaged: false,
  });
  const stored = await prisma.paperBreach.findMany({
    where: { campaignId: campaign.id, resolution: "active" },
    select: { condition: true },
  });
  const halting = [
    ...new Set(
      [
        ...breaches.map((b) => b.condition),
        ...stored.map((b) => b.condition),
      ].filter(halts),
    ),
  ];

  // --- Candidates ----------------------------------------------------------

  const candidates = await buildCandidates(game, now, portfolio);

  const plan = planCycle({
    now,
    kickoffAt: game.kickoffAt,
    config: {
      mode: config.mode,
      kellyFraction: Number(config.kellyFraction),
      perGameCapPct: config.perGameCapPct,
      perSlateCapPct: config.perSlateCapPct,
      probabilityCeiling: Number(config.probabilityCeiling),
    },
    recalibration: candidates.recalibration,
    recalibrationByVersion: candidates.recalibrationByVersion,
    activeBankrollCents,
    availableBankrollCents: settledBalanceCents,
    slateExposureCents,
    gameExposureCents,
    heldByContractId: Object.fromEntries(
      openPositions.map((p) => [
        p.contractId,
        { side: p.side, contracts: p.contracts },
      ]),
    ),
    candidates: candidates.rows,
    haltingBreaches: halting,
    markToMarketUnavailable: !mark.available && openPositions.length > 0,
  });

  const executed = await executeCycle({
    campaignId: campaign.id,
    riskConfigId: config.id,
    recalibrationId: candidates.recalibration?.id ?? null,
    gameId: game.id,
    gameWindowKey: gameWindowKey(game.kickoffAt),
    decisionDate: accountLocalDate(now, ACCOUNT_TIMEZONE),
    invocationId: args.invocationId,
    pipelineRunId: args.pipelineRunId,
    plan,
    breaches,
    snapshot: {
      bankrollAtEvaluationCents: activeBankrollCents,
      settledBalanceCents,
      openExposureCents: slateExposureCents,
      highWaterMarkCents: campaign.highWaterMarkCents,
      drawdownBps: drawdownBps(campaign.highWaterMarkCents, mark),
      calibrationBrier: calibration.rollingBrier,
      calibrationMarketBrier: calibration.marketBrier,
      calibrationSampleSize: calibration.observations,
    },
    startedAt: args.startedAt,
    finishedAt: new Date(),
  });

  return {
    cycleId: executed.status === "recorded" ? executed.cycleId : null,
    gameId: game.id,
    outcome: executed.status === "coalesced" ? "coalesced" : plan.outcome,
    skipReason: plan.skipReason,
    candidatesEvaluated: plan.candidatesEvaluated,
    candidatesFilled: plan.candidatesFilled,
    stakedCents: executed.status === "recorded" ? executed.stakedCents : 0,
  };
}

/** Resolvable contracts for the game, priced and staleness-qualified. */
async function buildCandidates(
  game: {
    id: string;
    season: number;
    homeTeamId: string;
    awayTeamId: string;
    kickoffAt: Date;
  },
  now: Date,
  portfolio: PortfolioTarget,
): Promise<{
  rows: CandidateInput[];
  recalibration: Awaited<ReturnType<typeof activeRecalibration>>;
  recalibrationByVersion: ReadonlyMap<
    string,
    NonNullable<Awaited<ReturnType<typeof activeRecalibration>>>
  >;
}> {
  const empty = {
    rows: [] as CandidateInput[],
    recalibration: null,
    recalibrationByVersion: new Map(),
  };
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
  if (contracts.length === 0) return empty;

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

  // A portfolio prices each stat from ITS model (PME-5): baseline / simulation
  // from their fixed engine, hybrid from the currently-selected model per stat.
  // Only projections whose model version matches the portfolio's choice for
  // that stat are considered — the other engine's projection is a different
  // portfolio's evidence, never this one's.
  const projections = await prisma.projection.findMany({
    where: {
      gameId: game.id,
      playerId: { in: contracts.map((c) => c.playerId as string) },
      // A stored shadow is never active merely by existing (RD-AS-3): the base
      // freshest is the default, overlaid below only by an ACCEPTED shadow.
      provenance: "base",
    },
    orderBy: { computedAt: "desc" },
    select: projectionSelect,
  });
  const freshest = new Map<string, (typeof projections)[number]>();
  for (const projection of projections) {
    const target = portfolio.modelVersionForStat(
      projection.statType as StatType,
    );
    if (target === null || projection.modelVersion !== target) continue;
    const key = `${projection.playerId}:${projection.statType}`;
    if (!freshest.has(key)) freshest.set(key, projection);
  }

  // An accepted suggestion's shadow IS the active projection for its key — the
  // bot trades the adjustment William approved, not the obsolete base. This is
  // a property of the ACTIVE production selection, so it applies to the Hybrid
  // portfolio (which mirrors that selection); the fixed-engine baseline and
  // simulation portfolios are pure shadow evaluations of their own engine and
  // do not inherit a suggestion accepted against a different model.
  if (portfolio.portfolio === "hybrid") {
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
        // key is player:game:stat; the cycle map is player:stat within one game.
        const [playerId, , statType] = key.split(":");
        const shadow = shadowById.get(shadowId);
        // The shadow only overlays when it matches the selected model for the
        // stat — an accepted adjustment against the non-selected engine is not
        // this portfolio's projection.
        const target = portfolio.modelVersionForStat(statType as StatType);
        if (shadow && shadow.modelVersion === target) {
          freshest.set(`${playerId}:${statType}`, shadow);
        }
      }
    }
  }

  // Pending / insufficient-evidence suggestions block the affected player's
  // contracts only (decision 1). Keyed player:stat within this game.
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

  // A fit per model version present among the freshest projections. Baseline
  // and simulation portfolios name exactly one version; hybrid may name two.
  // Each fit is keyed to its own model version, so the planner corrects every
  // candidate under ITS model's fit and crossing stays structurally impossible.
  const presentVersions = [
    ...new Set([...freshest.values()].map((p) => p.modelVersion)),
  ];
  const fits = await Promise.all(
    presentVersions.map((version) => activeRecalibration(version)),
  );
  const recalibrationByVersion = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof activeRecalibration>>>
  >();
  for (const fit of fits) {
    if (fit) recalibrationByVersion.set(fit.modelVersion, fit);
  }
  // The cycle's recorded fit is the primary one — the single version for a
  // fixed-engine portfolio, or the first present version for hybrid. Purely for
  // the stored `recalibrationId` on the cycle row; per-candidate correction
  // uses the map above.
  const recalibration = recalibrationByVersion.get(presentVersions[0]) ?? null;

  const rows: CandidateInput[] = [];
  for (const contract of contracts) {
    const projection = freshest.get(
      `${contract.playerId}:${contract.statType}`,
    );
    const observation = observationByContract.get(contract.id) ?? null;

    // The book read is per candidate and happens here rather than in the
    // planner, which stays pure. A Kalshi failure propagates and degrades the
    // whole cycle — it never yields a candidate with assumed depth.
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

  return { rows, recalibration, recalibrationByVersion };
}

async function startRun(
  invocationId: string,
  now: Date,
): Promise<string | null> {
  try {
    const run = await prisma.pipelineRun.create({
      data: {
        category: "paper_cycle",
        status: "running",
        invocationId,
        scope: null,
        codeVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
        startedAt: now,
      },
      select: { id: true },
    });
    return run.id;
  } catch (error) {
    const duplicate =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
    if (duplicate) return null;
    throw error;
  }
}

async function finishRun(
  id: string,
  status: "succeeded" | "failed",
  errorMessage: string | null,
): Promise<void> {
  await prisma.pipelineRun.update({
    where: { id },
    data: { status, finishedAt: new Date(), errorMessage },
  });
}
