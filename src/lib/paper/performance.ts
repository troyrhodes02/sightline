import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  BreachDto,
  PaperBotPerformanceDto,
  PortfolioBankrollSeriesDto,
  PortfolioBreachDto,
  ReadinessDetailDto,
} from "@/lib/dto/autonomy";
import type { ScorecardPeriod } from "@/lib/dto/model-eval";
import type { PaperPortfolio } from "../../../generated/prisma/enums";
import { readPortfolioScorecards } from "./scorecards";
import { readReadiness } from "./readiness";
import { halts } from "./breakers";

/**
 * Paper Bot → Performance read (PME-6, D10/D11/D19/D21).
 *
 * Composes the three portfolio scorecards (PME-5 `readPortfolioScorecards`) with
 * per-portfolio breach state, per-portfolio bankroll history for the 3-series
 * chart, and the full readiness evaluation (summary state + criterion detail,
 * D21). Every figure is a stored-data read at request time; the three portfolios
 * are never summed (D20). Nothing here writes configuration (D12), and the
 * readiness it surfaces is a report that never enables live trading (D21).
 */

const CONDITION_COPY: Record<
  BreachDto["condition"],
  { label: string; description: string }
> = {
  drawdown_warning: {
    label: "drawdown warning",
    description:
      "active bankroll has fallen from its high-water mark, measured mark-to-market",
  },
  drawdown_halt: {
    label: "drawdown halt",
    description:
      "active bankroll below the high-water mark by more than the mode's halt threshold, measured mark-to-market",
  },
  calibration: {
    label: "calibration",
    description:
      "rolling Brier has degraded against the backtest record, or fallen behind the market",
  },
  exposure: {
    label: "exposure",
    description: "open exposure exceeds the per-slate cap",
  },
  kill_switch: {
    label: "kill switch",
    description: "the kill switch is engaged",
  },
};

function toBreachDto(breach: {
  id: string;
  condition: BreachDto["condition"];
  measuredDisplay: string;
  thresholdDisplay: string;
  trippedAt: Date;
  resolution: BreachDto["resolution"];
  resolvedAt: Date | null;
  resolvedBy: { displayName: string | null; email: string } | null;
}): BreachDto {
  const copy = CONDITION_COPY[breach.condition];
  return {
    id: breach.id,
    condition: breach.condition,
    label: copy.label,
    conditionDescription: copy.description,
    measuredDisplay: breach.measuredDisplay,
    thresholdDisplay: breach.thresholdDisplay,
    trippedAt: breach.trippedAt.toISOString(),
    resolution: breach.resolution,
    resolvedAt: breach.resolvedAt?.toISOString() ?? null,
    resolvedByDisplayName:
      breach.resolvedBy?.displayName ?? breach.resolvedBy?.email ?? null,
    halts: halts(breach.condition),
  };
}

const PORTFOLIO_ORDER: Record<PaperPortfolio, number> = {
  baseline: 0,
  simulation: 1,
  hybrid: 2,
};

export async function readPaperBotPerformance(
  period: ScorecardPeriod = "campaign",
  now: Date = new Date(),
): Promise<PaperBotPerformanceDto> {
  const campaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: {
      id: true,
      killSwitchEngaged: true,
      campaignStartedAt: true,
      portfolios: {
        select: {
          id: true,
          portfolio: true,
          highWaterMarkCents: true,
        },
      },
    },
  });

  const readiness = await readinessDetail();

  if (!campaign || campaign.portfolios.length === 0) {
    return {
      campaignExists: false,
      killSwitchEngaged: campaign?.killSwitchEngaged ?? false,
      startingBankrollCents: 0,
      riskModeName: null,
      campaignStartedAt: campaign?.campaignStartedAt.toISOString() ?? null,
      scorecards: [],
      portfolioBreaches: [],
      bankrollSeries: [],
      readiness,
      period,
      emptyReason: "no_campaign",
    };
  }

  const sorted = [...campaign.portfolios].sort(
    (a, b) => PORTFOLIO_ORDER[a.portfolio] - PORTFOLIO_ORDER[b.portfolio],
  );

  const scorecards = await readPortfolioScorecards(campaign.id, period, now);

  // Per-portfolio breach state for the banner. Breaches are per portfolio; the
  // banner names which portfolio halted (design Screen 5).
  const activeBreaches = await prisma.paperBreach.findMany({
    where: {
      campaignId: { in: sorted.map((p) => p.id) },
      resolution: "active",
    },
    orderBy: { trippedAt: "desc" },
    include: { resolvedBy: { select: { displayName: true, email: true } } },
  });
  const byPortfolio = new Map<string, PaperPortfolio>(
    sorted.map((p) => [p.id, p.portfolio]),
  );

  const portfolioBreaches: PortfolioBreachDto[] = sorted.map((p) => {
    const breaches = activeBreaches
      .filter((b) => b.campaignId === p.id)
      .map(toBreachDto);
    return {
      portfolio: p.portfolio,
      breaches,
      halted: breaches.some((b) => b.halts),
    };
  });
  void byPortfolio;

  // Per-portfolio bankroll history (newest 500 ascending). The active risk
  // config's halt threshold gives each portfolio's halt reference line.
  const bankrollSeries: PortfolioBankrollSeriesDto[] = await Promise.all(
    sorted.map(async (p): Promise<PortfolioBankrollSeriesDto> => {
      const history = (
        await prisma.paperLedgerEntry.findMany({
          where: { campaignId: p.id },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 500,
          select: { occurredAt: true, balanceAfterCents: true },
        })
      ).reverse();
      const config = await prisma.paperRiskConfig.findFirst({
        where: { campaignId: p.id },
        orderBy: { effectiveFrom: "desc" },
        select: { drawdownHaltPct: true },
      });
      const haltThresholdCents = config
        ? Math.round(p.highWaterMarkCents * (1 - config.drawdownHaltPct / 100))
        : null;
      return {
        portfolio: p.portfolio,
        points: history.map((entry) => ({
          at: entry.occurredAt.toISOString(),
          settledCents: entry.balanceAfterCents,
        })),
        highWaterMarkCents: p.highWaterMarkCents,
        haltThresholdCents,
      };
    }),
  );

  const firstConfig = await prisma.paperRiskConfig.findFirst({
    where: { campaignId: sorted[0].id },
    orderBy: { effectiveFrom: "desc" },
    select: { mode: true },
  });

  return {
    campaignExists: true,
    killSwitchEngaged: campaign.killSwitchEngaged,
    startingBankrollCents: scorecards[0]?.startingBankrollCents ?? 0,
    riskModeName: firstConfig?.mode ?? null,
    campaignStartedAt: campaign.campaignStartedAt.toISOString(),
    scorecards,
    portfolioBreaches,
    bankrollSeries,
    readiness,
    period,
    emptyReason: null,
  };
}

/**
 * The readiness evaluation shaped for Performance: the summary state plus the
 * criterion-by-criterion detail (D21), and the three plain-language health
 * signals the summary strip renders. Nothing safety-relevant is dropped.
 */
async function readinessDetail(): Promise<ReadinessDetailDto> {
  const readiness = await readReadiness();

  const met = (key: string) =>
    readiness.criteria.find((c) => c.key === key)?.met ?? false;
  const positivePnl = met("positive_pnl");
  const modelQualityHealthy = readiness.criteria
    .filter((c) => c.category === "model_quality")
    .every((c) => c.met);
  const operationalHealthy = readiness.criteria
    .filter((c) => c.category === "safety_operations")
    .every((c) => c.met);

  return {
    state: readiness.state,
    weeksComplete: readiness.weeksComplete,
    weeksRequired: readiness.weeksRequired,
    activeConfigurationPortfolio: readiness.activeConfigurationPortfolio,
    paperResultPositive: positivePnl,
    modelQualityHealthy,
    operationalHealthy,
    disclaimer: readiness.disclaimer,
    criteria: readiness.criteria.map((c) => ({
      key: c.key,
      category: c.category,
      label: c.label,
      met: c.met,
      evidence: c.evidence,
      unevaluable: c.unevaluable,
    })),
  };
}
