import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";
// SIG-36: invalidating refresh tokens is the second of exactly two sanctioned
// uses of the service-role client. See src/lib/supabase/admin.ts.
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Ends access immediately.
 *
 * The list is a union, so the id may name a `User` or a pending `Invitation`.
 * Both are revoked here — from the admin's side it is one action, and asking
 * them to know which kind of row they are looking at would be an implementation
 * detail leaking into the interface.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireAdmin();
  const { id } = await params;

  if (id === session.user.id) {
    // Blocked server-side, not merely hidden. With one admin, self-revocation
    // would lock the product's only operator out of their own product.
    return jsonError("validation_error", "You cannot revoke your own access.");
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, status: true },
  });

  if (user) {
    if (user.status === "revoked") {
      return jsonError(
        "invalid_state_transition",
        "Access is already revoked.",
      );
    }

    const revokedAt = new Date();
    await prisma.user.update({
      where: { id },
      data: { status: "revoked", revokedAt },
    });

    // Best-effort. **A failure here does NOT fail the request**: the database
    // write is the authoritative gate, and requireSession denies this user on
    // their next request whether or not their refresh token was invalidated.
    // Rolling the revocation back because a token cleanup failed would leave an
    // admin believing access ended when it had not — the worse outcome by far.
    try {
      await createAdminClient().auth.admin.signOut(id, "global");
    } catch {
      console.error(
        `Revoked ${id} in the database, but Supabase token invalidation failed. Access is still denied on the next request.`,
      );
    }

    return Response.json(
      { id, email: user.email, revokedAt: revokedAt.toISOString() },
      { status: 200 },
    );
  }

  const invitation = await prisma.invitation.findUnique({
    where: { id },
    select: { id: true, email: true, acceptedAt: true, revokedAt: true },
  });

  if (!invitation) return jsonError("not_found", "No such user or invitation.");
  if (invitation.acceptedAt || invitation.revokedAt) {
    return jsonError("invalid_state_transition", "Access is already revoked.");
  }

  const revokedAt = new Date();
  await prisma.invitation.update({ where: { id }, data: { revokedAt } });

  return Response.json(
    { id, email: invitation.email, revokedAt: revokedAt.toISOString() },
    { status: 200 },
  );
}
