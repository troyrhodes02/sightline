import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { readBotDetail } from "@/lib/paper/bots-read";
import { PaperBotDetail } from "@/components/screens/PaperBotDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper Bot · Sightline" };

/**
 * Paper Bot → one bot's detail (design doc §9): bankroll graph, money summary,
 * the contracts the bot took, and its recent cycles, with rename and pause /
 * resume controls. Admin-only: `requireAdmin()` runs before any read, so a
 * viewer is rejected server-side with no shell first. A missing bot is a 404.
 */
export default async function PaperBotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const detail = await readBotDetail(id);
  if (!detail) notFound();

  return <PaperBotDetail detail={detail} />;
}
