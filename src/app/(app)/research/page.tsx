import { requireSession } from "@/lib/auth/session";
import { PropResearch } from "@/components/screens/PropResearch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prop Research · Sightline" };

/**
 * Prop Research — a shared, viewer-accessible destination (Pitch 10, Screen 7).
 * It runs no model and reads no price for a probability: every answer is a
 * read of a distribution Sightline has already computed, evaluated at the
 * entered threshold client-side (RD-1), with NO edge ever shown (RD-8).
 *
 * The page does NOT preload the eligible player set — that meant pulling every
 * upcoming projection on first paint, which made the page slow to open. The
 * client searches by name (2+ characters) against `/api/research/players` as
 * the user types, so the first paint is instant and the search is bounded.
 * `requireSession` gates it — an authenticated session, any role, is
 * sufficient; this is a shared surface, not an admin one.
 */
export default async function ResearchPage() {
  await requireSession();
  return <PropResearch initialPlayers={[]} />;
}
