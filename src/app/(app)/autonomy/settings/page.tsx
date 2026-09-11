import { requireAdmin } from "@/lib/auth/session";
import { readPaperBotSettings } from "@/lib/paper/settings";
import { PaperBotSettings } from "@/components/screens/PaperBotSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper Bot settings · Sightline" };

/**
 * Paper Bot → Settings (PME-6, D13). Per-stat model selection (the only
 * production-config mutation) plus bankroll, risk, withdrawal, and
 * continuous-evaluation config. Admin-only: `requireAdmin()` runs before any
 * read, so a viewer is rejected server-side with no shell first.
 */
export default async function SettingsPage() {
  await requireAdmin();
  const settings = await readPaperBotSettings();

  return <PaperBotSettings settings={settings} />;
}
