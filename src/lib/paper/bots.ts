import "server-only";

import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import type { PaperPortfolio } from "../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  CUSTOM_CAP_MAX_PCT,
  CUSTOM_CAP_MIN_PCT,
  CUSTOM_KELLY_MAX,
  CUSTOM_KELLY_MIN,
  DEFAULT_WITHDRAWAL_CEILING_MULTIPLE,
} from "./config";
import { ControlStateError, resolveConfig } from "./controls";

/**
 * The Paper Bot Lab create/manage surface.
 *
 * A "bot" IS a `PaperCampaign` row — the entire Pitch 7/11 machinery (bankroll,
 * ledger, cycles, positions, breaches, high-water, Kelly sizing, breakers,
 * withdrawals) reused, made first-class and freely configurable. A custom bot is
 * `isComparison = false`; the three canonical Baseline/Simulation/Hybrid bots are
 * `isComparison = true` and are authored elsewhere (bootstrap + `saveConfiguration`
 * fan-out), so Model Performance's engine comparison is untouched.
 *
 * **Config-writer invariant.** This module writes a `PaperRiskConfig` at bot
 * creation. That is a HUMAN create action — the admin choosing a bot's risk mode
 * once, at birth — not auto-tuning. The invariant the codebase guards is that no
 * risk parameter is ever derived from P&L or performance; that spirit is fully
 * preserved here. Every number comes from `resolveConfig` (the same preset logic
 * the configuration route uses) applied to the admin's chosen mode, never from a
 * bankroll, a win rate, a drawdown, or a replay result. The invariant test that
 * lists risk-config writers is extended to allow this module with that rationale.
 */

export const createBotInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    engine: z.enum(["baseline", "simulation", "hybrid"]),
    mode: z.enum(["conservative", "moderate", "aggressive", "custom"]),
    // Custom mode parameters, mirrored from the configuration schema. Ignored for
    // a preset mode (resolveConfig discards them), present so Custom is possible.
    kellyFraction: z
      .number()
      .min(CUSTOM_KELLY_MIN)
      .max(CUSTOM_KELLY_MAX)
      .optional(),
    perGameCapPct: z
      .number()
      .int()
      .min(CUSTOM_CAP_MIN_PCT)
      .max(CUSTOM_CAP_MAX_PCT)
      .optional(),
    perSlateCapPct: z
      .number()
      .int()
      .min(CUSTOM_CAP_MIN_PCT)
      .max(CUSTOM_CAP_MAX_PCT)
      .optional(),
    drawdownHaltPct: z
      .number()
      .int()
      .min(CUSTOM_CAP_MIN_PCT)
      .max(CUSTOM_CAP_MAX_PCT)
      .optional(),
    startingBankrollCents: z.number().int().positive(),
    withdrawalCeilingMultiple: z.number().min(1).max(100),
  })
  .strict();

export type CreateBotInput = z.infer<typeof createBotInputSchema>;

/**
 * Create a custom paper bot: a `PaperCampaign` (isComparison=false) plus its
 * opening-balance ledger entry and its own initial `PaperRiskConfig`, all in one
 * transaction so a bot is never observed with a bankroll but no opening balance,
 * or enabled but with no config for the cycle to size under.
 *
 * The bot attaches to an existing evaluation campaign (the parent that owns the
 * campaign-wide kill switch). It starts enabled so it begins accumulating on the
 * next scheduled cycle; the constraint (D10) is that bots only act when the
 * pipeline runs, never on creation.
 *
 * Returns the new bot's id.
 */
export async function createBot(
  input: {
    evaluationCampaignId: string;
    name: string;
    engine: PaperPortfolio;
    mode: CreateBotInput["mode"];
    customParams?: {
      kellyFraction?: number;
      perGameCapPct?: number;
      perSlateCapPct?: number;
      drawdownHaltPct?: number;
    };
    startingBankrollCents: number;
    withdrawalCeilingMultiple: number;
    actorUserId: string;
  },
  now: Date = new Date(),
  tx?: Prisma.TransactionClient,
): Promise<string> {
  if (input.startingBankrollCents <= 0) {
    throw new ControlStateError("the starting bankroll must be positive");
  }

  // Resolve the mode → numbers with the SAME preset logic the configuration
  // route uses. A preset ignores the custom params; custom validates them
  // (halt above warn, per-slate ≥ per-game) inside resolveConfig.
  const resolved = resolveConfig({
    mode: input.mode,
    withdrawalCeilingMultiple: input.withdrawalCeilingMultiple,
    autonomyEnabled: true,
    ...(input.customParams ?? {}),
  });

  const withdrawalCeilingMultiple =
    input.withdrawalCeilingMultiple ?? DEFAULT_WITHDRAWAL_CEILING_MULTIPLE;

  const run = async (client: Prisma.TransactionClient): Promise<string> => {
    // The parent must exist: a bot is a portfolio within an evaluation campaign,
    // and the campaign-wide kill switch lives on the parent.
    await client.paperEvaluationCampaign.findUniqueOrThrow({
      where: { id: input.evaluationCampaignId },
      select: { id: true },
    });

    const campaign = await client.paperCampaign.create({
      data: {
        evaluationCampaignId: input.evaluationCampaignId,
        portfolio: input.engine,
        // The bot name reuses the campaign label.
        label: input.name,
        isComparison: false,
        startingBankrollCents: input.startingBankrollCents,
        highWaterMarkCents: input.startingBankrollCents,
        highWaterMarkAt: now,
        startedAt: now,
        portfolioStartedAt: now,
        // A Lab bot starts enabled so it accumulates on the next cycle.
        autonomyEnabled: true,
      },
      select: { id: true },
    });

    // Opening balance is a ledger fact, exactly as the comparison bots record at
    // bootstrap — without it the scorecard reads a settled balance of 0 and
    // reports the bot as down its whole starting bankroll.
    await client.paperLedgerEntry.create({
      data: {
        campaignId: campaign.id,
        kind: "opening_balance",
        amountCents: input.startingBankrollCents,
        balanceAfterCents: input.startingBankrollCents,
        occurredAt: now,
      },
    });

    // The bot's OWN initial risk config. Every bot has a config from birth, so
    // the cycle's per-bot config read never skips it.
    const config = await client.paperRiskConfig.create({
      data: {
        campaignId: campaign.id,
        mode: resolved.mode,
        kellyFraction: resolved.kellyFraction,
        perGameCapPct: resolved.perGameCapPct,
        perSlateCapPct: resolved.perSlateCapPct,
        drawdownWarnPct: resolved.drawdownWarnPct,
        drawdownHaltPct: resolved.drawdownHaltPct,
        probabilityCeiling: resolved.probabilityCeiling,
        withdrawalCeilingMultiple,
        effectiveFrom: now,
        createdByUserId: input.actorUserId,
      },
      select: { id: true },
    });

    await client.paperControlEvent.create({
      data: {
        campaignId: campaign.id,
        kind: "enabled",
        actorUserId: input.actorUserId,
        detail: {
          riskConfigId: config.id,
          mode: resolved.mode,
          engine: input.engine,
          createdBot: true,
        },
        occurredAt: now,
      },
    });

    return campaign.id;
  };

  if (tx) return run(tx);
  return prisma.$transaction(run);
}

/**
 * Rename a bot. The name is the campaign label; renaming touches nothing else.
 */
export async function renameBot(
  botId: string,
  name: string,
  actorUserId: string,
  now: Date = new Date(),
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ControlStateError("a bot name cannot be empty");
  }
  await prisma.$transaction(async (tx) => {
    await tx.paperCampaign.findUniqueOrThrow({
      where: { id: botId },
      select: { id: true },
    });
    await tx.paperCampaign.update({
      where: { id: botId },
      data: { label: trimmed },
    });
    await tx.paperControlEvent.create({
      data: {
        campaignId: botId,
        kind: "config_changed",
        actorUserId,
        detail: { renamedTo: trimmed },
        occurredAt: now,
      },
    });
  });
}

/**
 * Pause or resume a single bot by flipping its own autonomy. Pause stops NEW
 * positions for this bot only; its siblings are untouched (the kill switch, which
 * is campaign-wide, is the separate campaign-level halt).
 */
export async function setBotAutonomy(
  botId: string,
  autonomyEnabled: boolean,
  actorUserId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.paperCampaign.findUniqueOrThrow({
      where: { id: botId },
      select: { id: true },
    });
    await tx.paperCampaign.update({
      where: { id: botId },
      data: { autonomyEnabled },
    });
    await tx.paperControlEvent.create({
      data: {
        campaignId: botId,
        kind: autonomyEnabled ? "enabled" : "disabled",
        actorUserId,
        occurredAt: now,
      },
    });
  });
}
