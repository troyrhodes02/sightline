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

  await prisma.$transaction(async (tx) => {
    await tx.adjustmentSuggestion.update({
      where: { id },
      data: { status: "accepted", decidedByUserId: userId, decidedAt: now },
    });
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
  });

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

  await prisma.adjustmentSuggestion.update({
    where: { id },
    data: { status: "declined", decidedByUserId: userId, decidedAt: now },
  });

  // The base stays active; the shadow is untouched and still graded.
  return {
    outcome: "applied",
    statusNow: "declined",
    suggestionId: id,
    activeProjectionId: suggestion.baseProjectionId,
  };
}
