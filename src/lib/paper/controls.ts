import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { RiskMode } from "../../../generated/prisma/enums";
import {
  CUSTOM_CAP_MAX_PCT,
  CUSTOM_CAP_MIN_PCT,
  CUSTOM_KELLY_MAX,
  CUSTOM_KELLY_MIN,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_WITHDRAWAL_CEILING_MULTIPLE,
  PROBABILITY_CEILING,
  RISK_PRESETS,
} from "./config";
import { halts } from "./breakers";

/**
 * The admin control surface: kill, resume, force override, and configuration.
 *
 * Four rules this module exists to make true of the data rather than of the
 * interface:
 *
 * 1. **Kill takes effect immediately and needs no confirmation.** Its purpose
 *    is to stop first and ask questions later. It deletes nothing.
 * 2. **Resume is only for a condition that has cleared.** While anything is
 *    still breached, the operator must use Force Override, which records that
 *    the bot wanted to stop and was overruled.
 * 3. **A force override does not disable the breaker.** The breach row is
 *    resolved; the condition is evaluated again on the very next cycle and may
 *    open a new row.
 * 4. **A configuration change appends a version.** No row is edited, so open
 *    positions and past cycles keep the limits they actually ran under.
 *
 * Every actor identity comes from the session. Nothing here reads a user id or
 * a role from a request body.
 */

export class ControlStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlStateError";
  }
}

/** The campaign, or null when autonomous paper trading was never set up. */
export async function activeCampaign() {
  return prisma.paperCampaign.findFirst({
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      startingBankrollCents: true,
      autonomyEnabled: true,
      killSwitchEngaged: true,
      highWaterMarkCents: true,
      highWaterMarkAt: true,
      startedAt: true,
    },
  });
}

export async function activeRiskConfig(campaignId: string) {
  return prisma.paperRiskConfig.findFirst({
    where: { campaignId },
    orderBy: { effectiveFrom: "desc" },
  });
}

export async function activeBreaches(campaignId: string) {
  return prisma.paperBreach.findMany({
    where: { campaignId, resolution: "active" },
    orderBy: { trippedAt: "desc" },
  });
}

/**
 * Engage the kill switch.
 *
 * No confirmation, by design, and idempotent: killing an already-killed
 * campaign is a no-op rather than an error, because the operator pressing it
 * twice under pressure must not see a failure.
 */
export async function engageKillSwitch(
  campaignId: string,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.paperCampaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { killSwitchEngaged: true },
    });
    if (campaign.killSwitchEngaged) return;

    await tx.paperCampaign.update({
      where: { id: campaignId },
      data: { killSwitchEngaged: true },
    });
    await tx.paperControlEvent.create({
      data: {
        campaignId,
        kind: "killed",
        actorUserId,
        occurredAt: now,
      },
    });
  });
}

/**
 * Release the kill switch.
 *
 * Releasing does NOT clear a breaker. If a condition is still breached the
 * campaign remains halted, which is the honest outcome: the kill switch and the
 * breakers are separate safeties and disengaging one must not silently
 * disengage the other.
 */
export async function releaseKillSwitch(
  campaignId: string,
  actorUserId: string,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.paperCampaign.update({
      where: { id: campaignId },
      data: { killSwitchEngaged: false },
    });
    await tx.paperControlEvent.create({
      data: {
        campaignId,
        kind: "kill_released",
        actorUserId,
        occurredAt: now,
      },
    });
  });
}

/**
 * Ordinary Resume, permitted only when every halting condition has cleared.
 *
 * The caller supplies the freshly re-evaluated conditions rather than trusting
 * the stored rows, so a breach that has genuinely gone away can be cleared and
 * one that has not cannot be papered over.
 */
export async function resume(
  campaignId: string,
  actorUserId: string,
  stillBreached: Set<string>,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const active = await tx.paperBreach.findMany({
      where: { campaignId, resolution: "active" },
      select: { id: true, condition: true },
    });

    const blocking = active.filter(
      (breach) =>
        halts(breach.condition) && stillBreached.has(breach.condition),
    );
    if (blocking.length > 0) {
      throw new ControlStateError(
        `still breached: ${blocking.map((b) => b.condition).join(", ")}`,
      );
    }

    for (const breach of active) {
      await tx.paperBreach.update({
        where: { id: breach.id },
        data: {
          resolution: "cleared",
          resolvedAt: now,
          resolvedByUserId: actorUserId,
        },
      });
    }

    await tx.paperControlEvent.create({
      data: {
        campaignId,
        kind: "resumed",
        actorUserId,
        detail: { clearedBreachIds: active.map((b) => b.id) },
        occurredAt: now,
      },
    });
  });
}

/**
 * Force Override: resume while a condition is still breached.
 *
 * Refused entirely while the kill switch is engaged — a human halt outranks a
 * human override of a machine halt. Refused if any named breach has cleared
 * since the page was loaded, because overriding a condition that is no longer
 * breached would put a false record in the audit trail. Refused unless EVERY
 * active halting breach is acknowledged: a partial override is not a state the
 * system can be in, since the unacknowledged condition would keep it halted
 * anyway while the record claimed otherwise.
 *
 * The resolved rows are `force_overridden`, which is terminal. They never
 * become `cleared`, at any age.
 */
export async function forceOverride(
  campaignId: string,
  actorUserId: string,
  breachIds: string[],
  stillBreached: Set<string>,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.paperCampaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { killSwitchEngaged: true },
    });
    if (campaign.killSwitchEngaged) {
      throw new ControlStateError(
        "the kill switch is engaged; disengage it before resuming",
      );
    }

    const active = await tx.paperBreach.findMany({
      where: { campaignId, resolution: "active" },
      select: { id: true, condition: true },
    });
    const halting = active.filter((breach) => halts(breach.condition));

    const named = new Set(breachIds);
    const unknown = breachIds.filter(
      (id) => !active.some((breach) => breach.id === id),
    );
    if (unknown.length > 0) {
      throw new ControlStateError(
        "a named breach does not belong to this campaign",
      );
    }

    const unacknowledged = halting.filter((breach) => !named.has(breach.id));
    if (unacknowledged.length > 0) {
      throw new ControlStateError(
        `every active condition must be acknowledged; missing ${unacknowledged
          .map((b) => b.condition)
          .join(", ")}`,
      );
    }

    const cleared = halting.filter(
      (breach) => !stillBreached.has(breach.condition),
    );
    if (cleared.length > 0) {
      throw new ControlStateError(
        `${cleared.map((b) => b.condition).join(", ")} has cleared; use Resume instead`,
      );
    }

    for (const breach of active) {
      await tx.paperBreach.update({
        where: { id: breach.id },
        data: {
          resolution: "force_overridden",
          resolvedAt: now,
          resolvedByUserId: actorUserId,
        },
      });
    }

    await tx.paperControlEvent.create({
      data: {
        campaignId,
        kind: "force_overridden",
        actorUserId,
        detail: {
          breachIds: active.map((b) => b.id),
          conditions: active.map((b) => b.condition),
        },
        occurredAt: now,
      },
    });
  });
}

export const configurationInputSchema = z
  .object({
    mode: z.enum(["conservative", "moderate", "aggressive", "custom"]),
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
    startingBankrollCents: z.number().int().positive().optional(),
    withdrawalCeilingMultiple: z.number().min(1).max(100),
    autonomyEnabled: z.boolean(),
  })
  .strict();

export type ConfigurationInput = z.infer<typeof configurationInputSchema>;

/**
 * Resolves the numbers a mode implies.
 *
 * A preset ignores whatever custom values arrived with the request, so
 * switching back to Conservative cannot leave an aggressive cap behind.
 */
export function resolveConfig(input: ConfigurationInput): {
  mode: RiskMode;
  kellyFraction: number;
  perGameCapPct: number;
  perSlateCapPct: number;
  drawdownWarnPct: number;
  drawdownHaltPct: number;
  probabilityCeiling: number;
} {
  if (input.mode !== "custom") {
    const preset = RISK_PRESETS[input.mode];
    return {
      mode: input.mode,
      ...preset,
      probabilityCeiling: PROBABILITY_CEILING,
    };
  }

  const preset = RISK_PRESETS.conservative;
  const perGameCapPct = input.perGameCapPct ?? preset.perGameCapPct;
  const perSlateCapPct = input.perSlateCapPct ?? preset.perSlateCapPct;
  if (perSlateCapPct < perGameCapPct) {
    throw new ControlStateError(
      "the per-slate cap must be at least the per-game cap",
    );
  }
  const drawdownHaltPct = input.drawdownHaltPct ?? preset.drawdownHaltPct;
  if (drawdownHaltPct <= preset.drawdownWarnPct) {
    throw new ControlStateError(
      "the drawdown halt must sit above the warning threshold",
    );
  }

  return {
    mode: "custom",
    kellyFraction: input.kellyFraction ?? preset.kellyFraction,
    perGameCapPct,
    perSlateCapPct,
    drawdownWarnPct: preset.drawdownWarnPct,
    drawdownHaltPct,
    // Never raised by a mode, custom included. Risk mode governs how much to
    // risk on acceptable opportunities, not what counts as acceptable.
    probabilityCeiling: PROBABILITY_CEILING,
  };
}

/**
 * Saves configuration by APPENDING a version and, where applicable, flipping
 * the campaign's operational switches.
 *
 * The starting bankroll is locked once any fill exists: it defines the
 * historical record, and changing it afterward would silently restate every
 * percentage the campaign has ever reported.
 */
export async function saveConfiguration(
  input: ConfigurationInput,
  actorUserId: string,
  now: Date,
): Promise<{ campaignId: string; riskConfigId: string }> {
  const resolved = resolveConfig(input);

  return prisma.$transaction(async (tx) => {
    let campaign = await tx.paperCampaign.findFirst({
      orderBy: { startedAt: "asc" },
      select: { id: true, startingBankrollCents: true },
    });

    if (!campaign) {
      const startingBankrollCents =
        input.startingBankrollCents ?? DEFAULT_STARTING_BANKROLL_CENTS;
      const created = await tx.paperCampaign.create({
        data: {
          startingBankrollCents,
          autonomyEnabled: false,
          killSwitchEngaged: false,
          highWaterMarkCents: startingBankrollCents,
          highWaterMarkAt: now,
          startedAt: now,
        },
        select: { id: true, startingBankrollCents: true },
      });
      campaign = created;
      // The opening balance is a ledger fact like any other, so the history is
      // reconstructible from the ledger alone rather than from the ledger plus
      // a remembered starting number.
      await tx.paperLedgerEntry.create({
        data: {
          campaignId: created.id,
          kind: "opening_balance",
          amountCents: startingBankrollCents,
          balanceAfterCents: startingBankrollCents,
          occurredAt: now,
        },
      });
    } else if (
      input.startingBankrollCents !== undefined &&
      input.startingBankrollCents !== campaign.startingBankrollCents
    ) {
      const fills = await tx.paperFill.count();
      if (fills > 0) {
        throw new ControlStateError(
          "the starting bankroll is locked once the campaign has positions",
        );
      }
      await tx.paperCampaign.update({
        where: { id: campaign.id },
        data: {
          startingBankrollCents: input.startingBankrollCents,
          highWaterMarkCents: input.startingBankrollCents,
          highWaterMarkAt: now,
        },
      });
      await tx.paperLedgerEntry.create({
        data: {
          campaignId: campaign.id,
          kind: "opening_balance",
          amountCents:
            input.startingBankrollCents - campaign.startingBankrollCents,
          balanceAfterCents: input.startingBankrollCents,
          note: "starting bankroll set before any position existed",
          occurredAt: now,
        },
      });
    }

    if (input.autonomyEnabled) {
      const blocking = await tx.paperBreach.findMany({
        where: { campaignId: campaign.id, resolution: "active" },
        select: { condition: true },
      });
      if (blocking.some((breach) => halts(breach.condition))) {
        throw new ControlStateError(
          "clear or override the active safety condition before enabling autonomy",
        );
      }
    }

    await tx.paperCampaign.update({
      where: { id: campaign.id },
      data: { autonomyEnabled: input.autonomyEnabled },
    });

    const config = await tx.paperRiskConfig.create({
      data: {
        campaignId: campaign.id,
        mode: resolved.mode,
        kellyFraction: resolved.kellyFraction,
        perGameCapPct: resolved.perGameCapPct,
        perSlateCapPct: resolved.perSlateCapPct,
        drawdownWarnPct: resolved.drawdownWarnPct,
        drawdownHaltPct: resolved.drawdownHaltPct,
        probabilityCeiling: resolved.probabilityCeiling,
        withdrawalCeilingMultiple:
          input.withdrawalCeilingMultiple ??
          DEFAULT_WITHDRAWAL_CEILING_MULTIPLE,
        effectiveFrom: now,
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });

    await tx.paperControlEvent.create({
      data: {
        campaignId: campaign.id,
        kind: input.autonomyEnabled ? "enabled" : "config_changed",
        actorUserId,
        detail: { riskConfigId: config.id, mode: resolved.mode },
        occurredAt: now,
      },
    });

    return { campaignId: campaign.id, riskConfigId: config.id };
  });
}
