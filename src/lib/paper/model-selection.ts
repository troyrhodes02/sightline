import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "../../../generated/prisma/client";
import type { PaperPortfolio, StatType } from "../../../generated/prisma/enums";
import {
  BASELINE_VERSION,
  SIMULATION_VERSION,
  modelSupportsStat,
} from "@/lib/model-eval/config";
import { selectionIsHybrid } from "./portfolios";

/**
 * Model selection — the ONE production-config mutation in Parallel Model
 * Evaluation (PME-6, D12/D13).
 *
 * Everything else in this feature is read-only with respect to production: a
 * recommendation is text, a leader is a chip, readiness is a report. This module
 * is the single writer of `ModelSelection`, reached only from
 * `POST /api/model-selection` behind a confirmed, admin-only human action. No
 * recommendation, leader, or readiness code path imports it — the invariant
 * suite asserts exactly one caller.
 *
 * Applying a selection has three coupled side effects that must succeed or fail
 * together (`$transaction`):
 *
 *  1. The `ModelSelection` row for the stat is upserted to the new version.
 *  2. The evaluation campaign's `activeConfigChangedAt` is stamped (audit /
 *     "configuration last changed").
 *  3. The **newly-active configuration's own portfolio** has its
 *     `portfolioStartedAt` reset, restarting the two-week readiness clock (D2).
 *     Prior weeks never transfer to the new configuration.
 *  4. A `PaperControlEvent(kind="config_changed")` is recorded on that portfolio.
 *
 * The actor is always the session user, never a body field. The chosen model
 * must support the stat (`invalid_model_for_stat`) — Simulation is rejected for
 * a stat it does not price.
 */

export class ModelSelectionError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_model_for_stat" | "no_campaign" | "unknown_model",
  ) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

/** The two model versions a stat may be assigned to. */
const KNOWN_VERSIONS = new Set([BASELINE_VERSION, SIMULATION_VERSION]);

export const modelSelectionInputSchema = z
  .object({
    statType: z.enum([
      "passing_yards",
      "rushing_yards",
      "receiving_yards",
      "receptions",
      "rushing_tds",
      "receiving_tds",
    ]),
    modelVersion: z.string().min(1),
    // Server-side confirmation gate. The UI raises a Dialog restating the
    // outgoing/incoming model and the readiness-reset consequence, then posts
    // `confirmed: true`. A body without it is refused (`confirmation_required`)
    // — production config never changes on an unconfirmed request.
    confirmed: z.literal(true),
  })
  .strict();

export type ModelSelectionInput = z.infer<typeof modelSelectionInputSchema>;

export type ModelSelectionRow = {
  statType: StatType;
  modelVersion: string;
};

/**
 * The current per-stat selection. Read for the Settings `ModelSelectionTable`
 * and by anyone that needs to know the active configuration. A stat absent from
 * the table is on the default Baseline (the seed ships all six on baseline, but
 * a defensive default keeps a missing row legible rather than blank).
 */
export async function readModelSelections(): Promise<ModelSelectionRow[]> {
  const rows = await prisma.modelSelection.findMany({
    select: { statType: true, modelVersion: true },
  });
  return rows;
}

/**
 * The portfolio a per-stat selection map resolves to as the *active
 * configuration* (D2): a genuinely mixed selection is `hybrid`; a uniformly
 * simulation selection is `simulation`; anything else (uniform baseline, or the
 * default) is `baseline`. This is the portfolio whose readiness clock the switch
 * resets and whose own evidence readiness later evaluates.
 */
export function activeConfigurationPortfolio(
  selection: Map<StatType, string>,
): PaperPortfolio {
  if (selectionIsHybrid(selection)) return "hybrid";
  const distinct = new Set(selection.values());
  if (distinct.size === 1 && distinct.has(SIMULATION_VERSION)) {
    return "simulation";
  }
  return "baseline";
}

async function selectionMap(
  client: Prisma.TransactionClient | typeof prisma,
): Promise<Map<StatType, string>> {
  const rows = await client.modelSelection.findMany({
    select: { statType: true, modelVersion: true },
  });
  return new Map(rows.map((row) => [row.statType, row.modelVersion]));
}

export type ActiveConfigurationPortfolio = {
  evaluationCampaignId: string;
  portfolio: PaperPortfolio;
  /** The resolved portfolio's PaperCampaign id, or null if not yet provisioned. */
  campaignId: string | null;
  portfolioStartedAt: Date | null;
};

/**
 * Resolves the portfolio the readiness gate must evaluate: the *active
 * configuration's own* portfolio (D2), within the single evaluation campaign.
 *
 * The readiness clock is counted from THIS portfolio's `portfolioStartedAt`, and
 * never borrows another portfolio's evidence. A switch that made the active
 * configuration Hybrid points here at the hybrid portfolio, whose clock was
 * reset at the switch — so prior baseline/simulation weeks do not transfer.
 *
 * Returns null when there is no evaluation campaign at all. Returns a resolved
 * portfolio with `campaignId === null` only in the rare window where the active
 * configuration resolves to a portfolio that has not been provisioned yet
 * (readiness then reports zero complete weeks, which is correct — there is no
 * evidence for that configuration).
 */
export async function resolveActiveConfigurationPortfolio(): Promise<ActiveConfigurationPortfolio | null> {
  const campaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: { id: true },
  });
  if (!campaign) return null;

  const selection = await selectionMap(prisma);
  const portfolioKind = activeConfigurationPortfolio(selection);

  // The readiness clock is anchored on the canonical COMPARISON bot of this
  // engine, never a custom Lab bot that happens to share the engine (Paper Bot
  // Lab dropped the one-per-portfolio unique, so this resolves by isComparison).
  const portfolio = await prisma.paperCampaign.findFirst({
    where: {
      evaluationCampaignId: campaign.id,
      portfolio: portfolioKind,
      isComparison: true,
    },
    select: { id: true, portfolioStartedAt: true },
  });

  return {
    evaluationCampaignId: campaign.id,
    portfolio: portfolioKind,
    campaignId: portfolio?.id ?? null,
    portfolioStartedAt: portfolio?.portfolioStartedAt ?? null,
  };
}

export type AppliedModelSelection = {
  statType: StatType;
  modelVersion: string;
  activeConfigurationPortfolio: PaperPortfolio;
  readinessClockResetAt: string | null;
};

/**
 * Apply a confirmed, human model selection. The only path that writes
 * `ModelSelection`.
 */
export async function applyModelSelection(input: {
  statType: StatType;
  modelVersion: string;
  actorUserId: string;
  now?: Date;
}): Promise<AppliedModelSelection> {
  if (!KNOWN_VERSIONS.has(input.modelVersion)) {
    throw new ModelSelectionError(
      `${input.modelVersion} is not a known model version.`,
      "unknown_model",
    );
  }
  if (!modelSupportsStat(input.modelVersion, input.statType)) {
    throw new ModelSelectionError(
      `The Simulation Engine does not price ${input.statType}.`,
      "invalid_model_for_stat",
    );
  }

  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // The single evaluation campaign, matched to how every other paper surface
    // resolves it (earliest-started). Model selection presupposes a campaign to
    // reset the readiness clock against.
    const campaign = await tx.paperEvaluationCampaign.findFirst({
      orderBy: { campaignStartedAt: "asc" },
      select: { id: true },
    });
    if (!campaign) {
      throw new ModelSelectionError(
        "No paper evaluation campaign exists yet.",
        "no_campaign",
      );
    }

    // Write the selection FIRST so the post-write selection map reflects the new
    // active configuration when we resolve which portfolio's clock to reset.
    await tx.modelSelection.upsert({
      where: { statType: input.statType },
      create: {
        statType: input.statType,
        modelVersion: input.modelVersion,
        note: "human selection (Paper Bot → Settings)",
      },
      update: {
        modelVersion: input.modelVersion,
        note: "human selection (Paper Bot → Settings)",
      },
    });

    await tx.paperEvaluationCampaign.update({
      where: { id: campaign.id },
      data: { activeConfigChangedAt: now },
    });

    const newSelection = await selectionMap(tx);
    const portfolioKind = activeConfigurationPortfolio(newSelection);

    // The newly-active configuration's OWN portfolio. Its clock resets; no other
    // portfolio's evidence transfers (D2). The portfolio may not exist yet if a
    // switch first creates a hybrid configuration — provision it so the clock
    // has an anchor. Baseline/simulation always exist for a live campaign.
    // The newly-active configuration's OWN comparison bot (Paper Bot Lab: resolve
    // by isComparison, since the engine is no longer unique per campaign).
    let portfolio = await tx.paperCampaign.findFirst({
      where: {
        evaluationCampaignId: campaign.id,
        portfolio: portfolioKind,
        isComparison: true,
      },
      select: { id: true },
    });

    if (!portfolio) {
      const parent = await tx.paperEvaluationCampaign.findUniqueOrThrow({
        where: { id: campaign.id },
        select: { startingBankrollCents: true },
      });
      const sibling = await tx.paperCampaign.findFirst({
        where: { evaluationCampaignId: campaign.id, isComparison: true },
        select: { autonomyEnabled: true },
      });
      const COMPARISON_LABELS: Record<PaperPortfolio, string> = {
        baseline: "Baseline",
        simulation: "Simulation",
        hybrid: "Hybrid",
      };
      portfolio = await tx.paperCampaign.create({
        data: {
          evaluationCampaignId: campaign.id,
          portfolio: portfolioKind,
          isComparison: true,
          label: COMPARISON_LABELS[portfolioKind],
          startingBankrollCents: parent.startingBankrollCents,
          highWaterMarkCents: parent.startingBankrollCents,
          highWaterMarkAt: now,
          startedAt: now,
          portfolioStartedAt: now,
          autonomyEnabled: sibling?.autonomyEnabled ?? false,
        },
        select: { id: true },
      });
    } else {
      await tx.paperCampaign.update({
        where: { id: portfolio.id },
        data: { portfolioStartedAt: now },
      });
    }

    await tx.paperControlEvent.create({
      data: {
        campaignId: portfolio.id,
        kind: "config_changed",
        actorUserId: input.actorUserId,
        detail: {
          statType: input.statType,
          modelVersion: input.modelVersion,
          activeConfigurationPortfolio: portfolioKind,
          readinessClockReset: true,
        },
        occurredAt: now,
      },
    });

    return {
      statType: input.statType,
      modelVersion: input.modelVersion,
      activeConfigurationPortfolio: portfolioKind,
      readinessClockResetAt: now.toISOString(),
    };
  });
}
