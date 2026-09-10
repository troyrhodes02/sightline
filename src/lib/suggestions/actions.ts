import "server-only";

import { prisma } from "@/lib/prisma";
import { annotateOpenPositionProjectionChanged } from "./active-projection";

/**
 * Accept / decline an Adjustment Suggestion (SIG-79). Admin-only at the route;
 * the acting user is resolved from the session and passed here — never from the
 * client. Both are one-action transitions from `pending`:
 *
 *  - **accept** makes the shadow the active projection (via the resolver — no
 *    row is mutated to do so) and annotates any open paper position on the
 *    affected contract that its projection changed after entry (decision 8;
 *    the position is left exactly as it is, never auto-exited).
 *  - **decline** leaves the base active; the shadow stays stored and graded.
 *
 * Idempotent: repeating the same action on an already-resolved suggestion in
 * that state returns `unchanged`. A transition from any other state is
 * `invalid` — the caller maps it to a 4xx and the client refreshes.
 */

export class SuggestionNotFoundError extends Error {}

export type SuggestionActionOutcome = "applied" | "unchanged" | "invalid";

export type SuggestionActionResult = {
  outcome: SuggestionActionOutcome;
  statusNow: string;
  suggestionId: string;
  /** The projection now active for the key: shadow if accepted, else base. */
  activeProjectionId: string | null;
};

async function loadSuggestion(id: string) {
  const suggestion = await prisma.adjustmentSuggestion.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      targetPlayerId: true,
      gameId: true,
      statType: true,
      baseProjectionId: true,
      shadowProjectionId: true,
    },
  });
  if (suggestion === null) throw new SuggestionNotFoundError(id);
  return suggestion;
}

export async function acceptSuggestion(
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<SuggestionActionResult> {
  const suggestion = await loadSuggestion(id);

  if (suggestion.status === "accepted") {
    return {
      outcome: "unchanged",
      statusNow: "accepted",
      suggestionId: id,
      activeProjectionId: suggestion.shadowProjectionId,
    };
  }
  if (
    suggestion.status !== "pending" ||
    suggestion.shadowProjectionId === null
  ) {
    // A declined / superseded / insufficient-evidence suggestion cannot be
    // accepted; the client should refresh to the resolved state.
    return {
      outcome: "invalid",
      statusNow: suggestion.status,
      suggestionId: id,
      activeProjectionId: suggestion.baseProjectionId,
    };
  }

  const applied = await prisma.$transaction(async (tx) => {
    // Conditional transition: only flip a row that is STILL pending. The status
    // was read outside the transaction, so a concurrent decline/accept could
    // have resolved it since; the WHERE guard makes the transition atomic and
    // the affected-row count tells us whether we won the race (review audit).
    const { count } = await tx.adjustmentSuggestion.updateMany({
      where: { id, status: "pending" },
      data: { status: "accepted", decidedByUserId: userId, decidedAt: now },
    });
    if (count === 0) return false;
    // Annotate any open paper position on the affected contract(s) — decision 8.
    const contracts = await tx.contract.findMany({
      where: {
        playerId: suggestion.targetPlayerId,
        gameId: suggestion.gameId,
        statType: suggestion.statType,
      },
      select: { id: true },
    });
    for (const contract of contracts) {
      await annotateOpenPositionProjectionChanged(tx, contract.id, now);
    }
    return true;
  });

  if (!applied) {
    // Lost the race — the row is no longer pending. Re-read and report the
    // resolved state so the client converges rather than acting on stale data.
    const now2 = await loadSuggestion(id);
    return {
      outcome: now2.status === "accepted" ? "unchanged" : "invalid",
      statusNow: now2.status,
      suggestionId: id,
      activeProjectionId:
        now2.status === "accepted"
          ? now2.shadowProjectionId
          : now2.baseProjectionId,
    };
  }

  return {
    outcome: "applied",
    statusNow: "accepted",
    suggestionId: id,
    activeProjectionId: suggestion.shadowProjectionId,
  };
}

export async function declineSuggestion(
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<SuggestionActionResult> {
  const suggestion = await loadSuggestion(id);

  if (suggestion.status === "declined") {
    return {
      outcome: "unchanged",
      statusNow: "declined",
      suggestionId: id,
      activeProjectionId: suggestion.baseProjectionId,
    };
  }
  if (suggestion.status !== "pending") {
    return {
      outcome: "invalid",
      statusNow: suggestion.status,
      suggestionId: id,
      activeProjectionId: suggestion.baseProjectionId,
    };
  }

  // Conditional transition, symmetric with accept: only decline a row that is
  // still pending, so a concurrent accept cannot be silently overwritten.
  const { count } = await prisma.adjustmentSuggestion.updateMany({
    where: { id, status: "pending" },
    data: { status: "declined", decidedByUserId: userId, decidedAt: now },
  });
  if (count === 0) {
    const now2 = await loadSuggestion(id);
    return {
      outcome: now2.status === "declined" ? "unchanged" : "invalid",
      statusNow: now2.status,
      suggestionId: id,
      activeProjectionId:
        now2.status === "accepted"
          ? now2.shadowProjectionId
          : now2.baseProjectionId,
    };
  }

  // The base stays active; the shadow is untouched and still graded.
  return {
    outcome: "applied",
    statusNow: "declined",
    suggestionId: id,
    activeProjectionId: suggestion.baseProjectionId,
  };
}
