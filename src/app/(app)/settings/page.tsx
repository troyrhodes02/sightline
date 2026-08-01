import { requireSession } from "@/lib/auth/session";
import { Settings } from "@/components/screens/Settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Sightline" };

export default async function SettingsPage() {
  const { user } = await requireSession();
  return <Settings user={user} />;
}
