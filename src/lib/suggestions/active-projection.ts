import { prisma } from "@/lib/prisma";
import type { Prisma } from "../../../generated/prisma/client";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * The active-projection resolution and autonomous-block helpers for Adjustment
 * Suggestions (SIG-78, RD-AS-3 / decision 1).
 *
 * Two facts every projection-selection site now needs:
 *
 *  - **A stored shadow is never active merely by existing.** Every freshest-
 *    projection query must restrict to `provenance: "base"`, or a shadow (which
 *    can carry a later `computedAt`) would silently become the displayed/ traded
 *    projection. That filter lives at each call site; this module supplies the
 *    other half:
 *  - **An ACCEPTED suggestion's shadow IS the active projection** for its
 *    (player, game, stat) key — bypassing the ModelSelection active-model filter,
 *    because acceptance makes it active by fiat. Never by mutating rows.
 *
 * And, for the autonomous cycle:
 *  - A **pending** material suggestion (or an **insufficient_evidence** hold)
 *    blocks trading of the affected player's contracts only — the same
 *    structural refusal as a stale projection, tagged `pending_suggestion`.
 */

export function projectionKey(
  playerId: string,
  gameId: string,
  statType: string,
): string {
  return `${playerId}:${gameId}:${statType}`;
}

/**
 * The accepted-shadow projection id per (player, game, stat) key among `keys`.
 * A key with no accepted suggestion is absent. At most one accepted suggestion
 * per key is expected; ties are broken by most-recent decision.
 */
export async function acceptedShadowProjectionIds(
  keys: Array<{ playerId: string; gameId: string; statType: StatType }>,
  tx: Prisma.TransactionClient = prisma,
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await tx.adjustmentSuggestion.findMany({
    where: {
      status: "accepted",
      shadowProjectionId: { not: null },
      OR: keys.map((k) => ({
        targetPlayerId: k.playerId,
        gameId: k.gameId,
        statType: k.statType,
      })),
    },
    orderBy: { decidedAt: "desc" },
    select: {
      targetPlayerId: true,
      gameId: true,
      statType: true,
      shadowProjectionId: true,
    },
  });
  const out = new Map<string, string>();
  for (const row of rows) {
    const key = projectionKey(row.targetPlayerId, row.gameId, row.statType);
    // decidedAt desc → first seen is the most recent acceptance.
    if (!out.has(key) && row.shadowProjectionId) {
      out.set(key, row.shadowProjectionId);
    }
  }
  return out;
}

export type BlockReason = { held: boolean };

/**
 * The `player:statType` keys in a game whose contracts must be refused by the
 * autonomous cycle because a suggestion is unresolved: a `pending` material
 * suggestion, or an `insufficient_evidence` hold (the model cannot defensibly
 * estimate the adjustment — decision 6). `held` distinguishes the two for the
 * recorded reason detail. Keyed WITHOUT the game id, because the caller already
 * scopes to one game.
 */
export async function blockedSuggestionKeys(
  gameId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Map<string, BlockReason>> {
  const rows = await tx.adjustmentSuggestion.findMany({
    where: {
      gameId,
      status: { in: ["pending", "insufficient_evidence"] },
    },
    select: { targetPlayerId: true, statType: true, status: true },
  });
  const out = new Map<string, BlockReason>();
  for (const row of rows) {
    const key = `${row.targetPlayerId}:${row.statType}`;
    const held = row.status === "insufficient_evidence";
    // A hold is the stronger statement; never downgrade it to a plain pending.
    const existing = out.get(key);
    out.set(key, { held: held || (existing?.held ?? false) });
  }
  return out;
}

/**
 * Annotate the open paper position on a contract that its projection changed
 * after entry (decision 8). The position is left EXACTLY as it is — Sightline
 * never auto-exits, offsets, or reduces it. Composes into the accept
 * transaction; a contract with no open position is a no-op.
 */
export async function annotateOpenPositionProjectionChanged(
  tx: Prisma.TransactionClient,
  contractId: string,
  now: Date,
): Promise<void> {
  await tx.paperPosition.updateMany({
    where: { contractId, status: "open", projectionChangedAfterEntry: false },
    data: { projectionChangedAfterEntry: true, projectionChangedAt: now },
  });
}
