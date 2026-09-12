import "server-only";

import { prisma } from "@/lib/prisma";
import {
  readComparison,
  readProjectionAccuracy,
  readRecommendation,
  readStatLeaders,
} from "@/lib/model-eval";
import { readPortfolioScorecards } from "@/lib/paper/scorecards";
import { readReadinessSummary } from "@/lib/paper/read";
import type {
  ModelPerformanceDto,
  ModelPerformanceLevel,
} from "@/lib/dto/model-eval";

/**
 * The Model Performance surface read (PME-4, spec §UI integration, §UI data
 * contracts).
 *
 * This is an assembly, never a computation: it composes the model-comparison
 * evidence layer (D1/D3/D4 — `readComparison`, `readStatLeaders`,
 * `readRecommendation`) with the paper scorecards + readiness summary (D5/D2).
 * It reads no price into the comparison, resolves no fit itself, and — being a
 * read — cannot write `ModelSelection` or any config (D12). Live and Backtest
 * are assembled as two separate records (D15); nothing here blends them.
 *
 * The scorecards and readiness are `null` when no paper evaluation campaign
 * exists yet, which is a designed no-campaign state (link to Settings), not an
 * error and not an empty array of a campaign that has zero portfolios.
 */
export async function readModelPerformance(): Promise<ModelPerformanceDto> {
  const [
    overallLive,
    overallBacktest,
    recommendation,
    statLeadersLive,
    statLeadersBacktest,
    projectionAccuracy,
  ] = await Promise.all([
    readComparison("live", "contract_like"),
    readComparison("backtest", "contract_like"),
    readRecommendation("live"),
    readStatLeaders("live"),
    readStatLeaders("backtest"),
    readProjectionAccuracy(),
  ]);

  // Resolve the active paper evaluation campaign. There is at most one running
  // campaign; take the earliest-started one to match `readCampaignState`'s
  // resolution so both surfaces name the same campaign.
  const campaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: { id: true },
  });

  let scorecards: ModelPerformanceDto["scorecards"] = null;
  let readiness: ModelPerformanceDto["readiness"] = null;
  let hybridSelected = false;

  if (campaign) {
    scorecards = await readPortfolioScorecards(campaign.id);
    hybridSelected = scorecards.some((card) => card.portfolio === "hybrid");

    // The readiness clock is anchored on the earliest-started portfolio of the
    // campaign, mirroring the paper overview's summary; without a portfolio
    // there is nothing to measure and readiness stays null.
    const portfolio = await prisma.paperCampaign.findFirst({
      where: { evaluationCampaignId: campaign.id },
      orderBy: { startedAt: "asc" },
      select: { id: true },
    });
    if (portfolio) {
      const summary = await readReadinessSummary(portfolio.id);
      // The summary read never reports `eligible_for_live_trading` (that requires
      // the full readiness surface's model-quality + safety evidence), so the
      // narrow two-state strip is faithful; guard the type regardless.
      readiness = {
        state:
          summary.state === "paper_evidence_building"
            ? "paper_evidence_building"
            : "not_ready",
        weeksComplete: summary.weeksComplete,
        weeksRequired: summary.weeksRequired,
      };
    }
  }

  return {
    overallLive,
    overallBacktest,
    recommendation,
    statLeadersLive,
    statLeadersBacktest,
    scorecards,
    readiness,
    hybridSelected,
    projectionAccuracy,
  };
}

const LEVELS: ReadonlySet<ModelPerformanceLevel> = new Set([
  "summary",
  "breakdown",
  "advanced",
]);

/**
 * Parses the `?level=` query param. Like every other scope on this surface, an
 * unrecognized value falls back to the default (`summary`) silently rather than
 * erroring — the URL is user-editable input, not a form.
 */
export function parseLevel(
  value: string | string[] | undefined,
): ModelPerformanceLevel {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && LEVELS.has(raw as ModelPerformanceLevel)
    ? (raw as ModelPerformanceLevel)
    : "summary";
}
