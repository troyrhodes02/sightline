import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

const schema = z.object({ playerId: z.uuid() }).strict();

/**
 * Manual contract-to-player correction — the minimal control the pitch
 * allows, nothing resembling a mapping operations suite.
 *
 * Writes the mapping through the Pitch 1 identity mechanism as
 * `manual_override`, so every future sync resolves this Kalshi name
 * automatically. **Future reads only (RD-9):** previously recorded
 * observations, snapshots, and decisions are untouched — history reflects
 * what was observed when it was observed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireAdmin();
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "Expected a JSON body.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Expected { playerId }.");
  }

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true,
      kalshiPlayerName: true,
      title: true,
      resolutionStatus: true,
      gameId: true,
      statType: true,
      threshold: true,
    },
  });
  if (!contract) return jsonError("not_found", "No such contract.");

  if (
    contract.resolutionStatus !== "unresolved" &&
    contract.resolutionStatus !== "ambiguous"
  ) {
    return jsonError(
      "invalid_state_transition",
      "This contract is already resolved.",
    );
  }

  const player = await prisma.player.findUnique({
    where: { id: parsed.data.playerId },
    select: { id: true, fullName: true },
  });
  if (!player) return jsonError("not_found", "No such player.");

  // The Kalshi name being mapped. Falls back to the verbatim title for the
  // pathological market whose name never parsed — the mapping still helps
  // nothing then, but the contract itself must still be correctable.
  const kalshiName = contract.kalshiPlayerName ?? contract.title;
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.playerExternalId.upsert({
      where: {
        source_externalId_externalName: {
          source: "kalshi",
          externalId: kalshiName,
          externalName: kalshiName,
        },
      },
      create: {
        source: "kalshi",
        externalId: kalshiName,
        externalName: kalshiName,
        playerId: player.id,
        status: "manual_override",
        resolvedBy: session.user.id,
        resolvedAt: now,
      },
      update: {
        playerId: player.id,
        status: "manual_override",
        candidateIds: [],
        resolvedBy: session.user.id,
        resolvedAt: now,
      },
    });

    // Game, stat type, and threshold stay as the sync parsed them; the manual
    // control corrects the PLAYER mapping only. A contract still missing its
    // game resolves fully on the next sync pass, which re-runs resolution for
    // non-final statuses — but with the player now settled, so it stays
    // manual_override rather than regressing to a name match.
    return tx.contract.update({
      where: { id: contract.id },
      data: {
        playerId: player.id,
        resolutionStatus:
          contract.gameId && contract.statType && contract.threshold !== null
            ? "manual_override"
            : "unresolved",
        resolutionNote:
          contract.gameId && contract.statType && contract.threshold !== null
            ? null
            : "Player mapped manually; game, stat, or threshold still unparsed.",
      },
      select: {
        id: true,
        kalshiTicker: true,
        playerId: true,
        gameId: true,
        statType: true,
        threshold: true,
        resolutionStatus: true,
        resolutionNote: true,
      },
    });
  });

  return Response.json(
    {
      ...updated,
      threshold: updated.threshold === null ? null : Number(updated.threshold),
      playerName: player.fullName,
    },
    { status: 200 },
  );
}
