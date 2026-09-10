import { requireSession } from "@/lib/auth/session";
import { readResearchPlayers } from "@/lib/research/read";

export const dynamic = "force-dynamic";

/**
 * Prop Research player search (Pitch 10 — spec §9). Viewer-accessible: an
 * authenticated session is sufficient, because Prop Research is a shared
 * surface. Returns only players who have a current stored BASE projection for
 * an upcoming (pre-kickoff) game, matching the partial `q`.
 *
 * A pure database read through Prisma — no model runs, no price reads. An empty
 * or missing `q` returns the unfiltered eligible set.
 */
export async function GET(request: Request): Promise<Response> {
  await requireSession();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const players = await readResearchPlayers(q);
  return Response.json({ players }, { status: 200 });
}
