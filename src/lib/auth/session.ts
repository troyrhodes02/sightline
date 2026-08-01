import "server-only";

import { forbidden, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createServerClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: "admin" | "viewer";
};

export type SessionContext = { user: SessionUser };

/** How often `lastActiveAt` is refreshed. Three users; once per session-ish. */
const LAST_ACTIVE_THROTTLE_MS = 15 * 60 * 1000;

/**
 * Resolves the caller. **Two checks, not one.**
 *
 *  1. Supabase verifies the access token — authentication.
 *  2. Postgres confirms the account is still active — authorization.
 *
 * Step 2 is the whole mechanism behind "revocation takes effect immediately,
 * including when a session was already active". An access token minted before
 * revocation still verifies, still decodes, and still carries whatever role
 * claim it was issued with; only the database knows access ended ninety seconds
 * ago. **Never read a role from a token claim.**
 *
 * The cost is a query per protected request, which at three users and a slate
 * of fourteen games is not a cost. The alternative — trusting the token until
 * it expires — makes revocation a promise the product cannot keep.
 *
 * Consequence worth stating: no authenticated route may be statically rendered
 * or cached, or a revoked user is served a shell from cache.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) redirect("/sign-in");

  const user = await prisma.user.findUnique({
    where: { id: data.user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      lastActiveAt: true,
    },
  });

  // An auth user with no `users` row is not a valid caller. It can only arise
  // from a half-completed acceptance, and treating it as anonymous is the safe
  // reading — see the rollback in the acceptance route.
  if (!user || user.status === "revoked") {
    await supabase.auth.signOut();
    redirect("/sign-in?reason=revoked");
  }

  void touchLastActive(user.id, user.lastActiveAt);

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
  };
}

/**
 * Admin surfaces. Renders the denial **in place at the requested URL** with a
 * 403 — not a redirect, and never after admin chrome has already been drawn.
 *
 * A redirect would leak that the route exists and is worth redirecting away
 * from; rendering in place with the viewer's own shell reveals nothing.
 */
export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (session.user.role !== "admin") forbidden();
  return session;
}

/**
 * Refreshes `lastActiveAt`, at most once per throttle window.
 *
 * Fire-and-forget: a failure here must never fail the request it rode in on.
 * An activity timestamp is a nicety on an admin screen, not something worth
 * turning into an outage.
 */
async function touchLastActive(
  userId: string,
  lastActiveAt: Date | null,
): Promise<void> {
  const now = Date.now();
  if (
    lastActiveAt !== null &&
    now - lastActiveAt.getTime() < LAST_ACTIVE_THROTTLE_MS
  ) {
    return;
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date(now) },
    });
  } catch {
    // Deliberately swallowed. See above.
  }
}
