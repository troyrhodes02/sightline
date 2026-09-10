import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { readResearchProjection } from "@/lib/research/read";

export const dynamic = "force-dynamic";

/**
 * The six stored stat types. A `statType` outside this set is not a stored
 * distribution, so it resolves to the honest "no projection" state rather than
 * an error — the client renders the same no-data card either way.
 */
const query = z
  .object({
    playerId: z.string().min(1),
    gameId: z.string().min(1),
    statType: z.enum([
      "passing_yards",
      "rushing_yards",
      "receiving_yards",
      "receptions",
      "rushing_tds",
      "receiving_tds",
    ]),
  })
  .strict();

/**
 * Prop Research projection (Pitch 10 — spec §9, RD-4, RD-8). Viewer-accessible.
 *
 * Returns the BASE distribution + metadata so the client recomputes P(≥)/P(<)
 * locally on every threshold — the THRESHOLD IS NOT A PARAMETER here, because
 * no engine runs on threshold entry. Honest unavailable JSON (`available:false`
 * with a reason) when there is no current base projection or the game has
 * kicked off. Never an edge, never a fabricated distribution.
 */
export async function GET(request: Request): Promise<Response> {
  await requireSession();

  const params = new URL(request.url).searchParams;
  const parsed = query.safeParse({
    playerId: params.get("playerId") ?? undefined,
    gameId: params.get("gameId") ?? undefined,
    statType: params.get("statType") ?? undefined,
  });

  if (!parsed.success) {
    // A malformed stat/player/game reads as "nothing to research", not a 4xx
    // the client would have to special-case — the no-data card is the honest
    // surface for every unavailable path.
    return Response.json(
      {
        available: false,
        reason: "no_projection",
        playerName: null,
        statType: null,
        gameLabel: null,
      },
      { status: 200 },
    );
  }

  const result = await readResearchProjection(parsed.data);
  return Response.json(result, { status: 200 });
}
