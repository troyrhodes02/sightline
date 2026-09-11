import "server-only";

import type { Prisma } from "../../../generated/prisma/client";
import type { PaperPortfolio, StatType } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { BASELINE_VERSION, SIMULATION_VERSION } from "@/lib/model-eval/config";

/**
 * The three-portfolio fan-out for one paper-evaluation campaign (PME-5, D5/D6/D11).
 *
 * A `PaperEvaluationCampaign` owns up to three `PaperCampaign` children — one per
 * portfolio. Each child keeps its own bankroll, ledger, cycles, positions, and
 * breaches: the entire Pitch 7 machinery reused, fed the same eligible windows
 * and the same active `PaperRiskConfig`, differing only in WHICH model's
 * projection drives each candidate's probability.
 *
 * - `baseline` always prices from `baseline-zil-*`.
 * - `simulation` always prices from `simulation-mc-*`.
 * - `hybrid` prices per stat from the currently-selected `ModelSelection`, and
 *   exists only while a mixed selection exists.
 *
 * The portfolios never merge — not with each other and not with any future
 * live-money ledger. This module resolves and (idempotently) provisions them;
 * it never aggregates across them.
 */

export type PortfolioTarget = {
  campaignId: string;
  portfolio: PaperPortfolio;
  highWaterMarkCents: number;
  startingBankrollCents: number;
  autonomyEnabled: boolean;
  /**
   * Resolves the model version that prices a stat for THIS portfolio. Baseline
   * and simulation ignore the argument; hybrid consults the active selection.
   */
  modelVersionForStat: (statType: StatType) => string | null;
};

/**
 * The active per-stat selection, read once. A stat absent from the table has no
 * active model — hybrid selects no projection for it, exactly as the slate does.
 */
async function modelSelectionMap(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<StatType, string>> {
  const rows = await client.modelSelection.findMany({
    select: { statType: true, modelVersion: true },
  });
  return new Map(rows.map((row) => [row.statType, row.modelVersion]));
}

/**
 * Whether the current selection is genuinely Hybrid — i.e. it names more than
 * one distinct model version across the stats it covers. A selection that is
 * uniformly baseline (or uniformly simulation) is NOT hybrid; the hybrid
 * portfolio would be a duplicate of an engine portfolio and is not provisioned
 * (D11: Hybrid absent when no hybrid selection).
 */
export function selectionIsHybrid(selection: Map<StatType, string>): boolean {
  const distinct = new Set(selection.values());
  return distinct.size > 1;
}

/** The engine version a fixed-engine portfolio prices from. */
function fixedEngineVersion(portfolio: PaperPortfolio): string {
  return portfolio === "simulation" ? SIMULATION_VERSION : BASELINE_VERSION;
}

/**
 * Resolve every portfolio target for a campaign, provisioning any sibling that
 * does not yet exist. Baseline and simulation are always present; hybrid is
 * present only when the live selection is genuinely mixed.
 *
 * Provisioning is idempotent: the `@@unique([evaluationCampaignId, portfolio])`
 * constraint means a concurrent invocation cannot create a duplicate, and an
 * already-present portfolio is returned unchanged. Siblings are seeded from the
 * SAME starting bankroll (from the parent) so the three accumulate under
 * identical assumptions.
 */
export async function resolvePortfolios(
  evaluationCampaignId: string,
): Promise<PortfolioTarget[]> {
  const parent = await prisma.paperEvaluationCampaign.findUniqueOrThrow({
    where: { id: evaluationCampaignId },
    select: {
      startingBankrollCents: true,
      campaignStartedAt: true,
      portfolios: {
        select: {
          id: true,
          portfolio: true,
          highWaterMarkCents: true,
          startingBankrollCents: true,
          autonomyEnabled: true,
        },
      },
    },
  });

  const selection = await modelSelectionMap();
  const wanted: PaperPortfolio[] = ["baseline", "simulation"];
  if (selectionIsHybrid(selection)) wanted.push("hybrid");

  const existing = new Map(parent.portfolios.map((p) => [p.portfolio, p]));

  const targets: PortfolioTarget[] = [];
  for (const portfolio of wanted) {
    let row = existing.get(portfolio);
    if (!row) {
      // Deterministic: a new sibling mirrors the BASELINE portfolio's autonomy
      // (baseline is always provisioned first, at bootstrap), never an arbitrary
      // row of an unordered relation. Default off when baseline is somehow absent.
      const autonomyEnabled =
        existing.get("baseline")?.autonomyEnabled ??
        parent.portfolios.find((p) => p.portfolio === "baseline")
          ?.autonomyEnabled ??
        false;
      // Campaign and its opening-balance ledger entry are created atomically, so
      // a sibling is never observed with a bankroll but no opening balance. The
      // risk config is NOT copied here: it is authored in exactly one place (the
      // configuration route) and SHARED across the campaign's portfolios by the
      // cycle, which is what keeps "risk mode never changes itself" structural.
      const created = await prisma.$transaction(async (tx) => {
        const campaign = await tx.paperCampaign.create({
          data: {
            evaluationCampaignId,
            portfolio,
            startingBankrollCents: parent.startingBankrollCents,
            highWaterMarkCents: parent.startingBankrollCents,
            highWaterMarkAt: parent.campaignStartedAt,
            startedAt: parent.campaignStartedAt,
            portfolioStartedAt: parent.campaignStartedAt,
            autonomyEnabled,
          },
          select: {
            id: true,
            portfolio: true,
            highWaterMarkCents: true,
            startingBankrollCents: true,
            autonomyEnabled: true,
          },
        });
        // Opening balance is a ledger fact, exactly as the baseline records at
        // bootstrap — without it the scorecard reads a settled balance of 0 and
        // reports the portfolio as down its whole starting bankroll.
        await tx.paperLedgerEntry.create({
          data: {
            campaignId: campaign.id,
            kind: "opening_balance",
            amountCents: parent.startingBankrollCents,
            balanceAfterCents: parent.startingBankrollCents,
            occurredAt: parent.campaignStartedAt,
          },
        });
        return campaign;
      });
      row = created;
      existing.set(portfolio, created);
    }

    const modelVersionForStat =
      portfolio === "hybrid"
        ? (statType: StatType) => selection.get(statType) ?? null
        : () => fixedEngineVersion(portfolio);

    targets.push({
      campaignId: row.id,
      portfolio: row.portfolio,
      highWaterMarkCents: row.highWaterMarkCents,
      startingBankrollCents: row.startingBankrollCents,
      autonomyEnabled: row.autonomyEnabled,
      modelVersionForStat,
    });
  }

  return targets;
}
