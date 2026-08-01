import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";

/**
 * **Every authenticated route is dynamic.**
 *
 * Not a performance choice. `requireSession` re-reads `users.status` from
 * Postgres on each request, which is what makes revocation immediate; a cached
 * or statically rendered shell would serve a revoked user their old page and
 * quietly undo the entire mechanism.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Awaited before anything renders, so navigation is never drawn and then
  // corrected. A shell that shows admin tabs and then removes them has already
  // told a viewer the admin layer exists.
  const { user } = await requireSession();

  return <AppShell user={user}>{children}</AppShell>;
}
