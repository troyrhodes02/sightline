import { requireSession } from "@/lib/auth/session";
import { readResearchPlayers } from "@/lib/research/read";
import { PropResearch } from "@/components/screens/PropResearch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prop Research · Sightline" };

/**
 * Prop Research — a shared, viewer-accessible destination (Pitch 10, Screen 7).
 * It runs no model and reads no price for a probability: every answer is a
 * read of a distribution Sightline has already computed, evaluated at the
 * entered threshold client-side (RD-1), with NO edge ever shown (RD-8).
 *
 * The server seeds the eligible player set (the client refetches against
 * `/api/research/players` as the user types), so a deep-linked player resolves
 * on first paint. `requireSession` gates it — an authenticated session, any
 * role, is sufficient; this is a shared surface, not an admin one.
 */
export default async function ResearchPage() {
  await requireSession();
  const initialPlayers = await readResearchPlayers("");
  return <PropResearch initialPlayers={initialPlayers} />;
}
