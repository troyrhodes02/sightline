import { requireAdmin } from "@/lib/auth/session";
import { readAccessRows } from "@/lib/access/read";
import { Users } from "@/components/screens/Users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users · Sightline" };

export default async function UsersPage() {
  // Denies in place with a 403 before anything renders — no admin chrome first.
  const { user } = await requireAdmin();
  const rows = await readAccessRows(user.id);

  return <Users rows={rows} />;
}
