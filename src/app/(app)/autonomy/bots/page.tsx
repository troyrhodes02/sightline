import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { readPaperBots } from "@/lib/paper/bots-read";
import { PaperBotList } from "@/components/screens/PaperBotList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper Bot Lab · Sightline" };

/**
 * Paper Bot → Bots (design doc §9). The Paper Bot Lab landing: every bot under
 * the active evaluation campaign — comparison and custom — with a "+ New bot"
 * affordance. Admin-only: `requireAdmin()` runs before any read, so a viewer is
 * rejected server-side with no shell first.
 */
export default async function PaperBotsPage() {
  await requireAdmin();

  // The bots attach to the active evaluation campaign — the earliest-started
  // parent that owns the campaign-wide kill switch, resolved the same way the
  // create route resolves it.
  const campaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: { id: true },
  });

  const bots = campaign ? await readPaperBots(campaign.id) : [];

  return <PaperBotList bots={bots} />;
}
