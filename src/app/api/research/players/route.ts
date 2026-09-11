import { requireSession } from "@/lib/auth/session";
import { readResearchPlayers } from "@/lib/research/read";

export const dynamic = "force-dynamic";

/**
 * Prop Research player search (Pitch 10 — spec §9). Viewer-accessible: an
 * authenticated session is sufficient, because Prop Research is a shared
 * surface. Returns only players who have a current stored BASE projection for
 * an upcoming (pre-kickoff) game, matching the partial `q`.
 *
 * A pure database read through Prisma — no model runs, no price reads. The
 * search is name-driven and requires at least two characters; a shorter (or
 * missing) `q` returns an empty list without scanning the projection table, so
 * a stray empty request never runs an unbounded query.
 */
export async function GET(request: Request): Promise<Response> {
  await requireSession();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const players = await readResearchPlayers(q);
  return Response.json({ players }, { status: 200 });
}
