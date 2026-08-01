import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";
// Invalidating refresh tokens is one of the sanctioned uses of the service-role
// client. See src/lib/supabase/admin.ts and the structural test that tracks it.
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z
  .object({ action: z.enum(["approve", "deny", "revoke"]) })
  .strict();

/**
 * Which statuses each action may act on.
 *
 * Expressed as a table rather than a chain of `if`s so an illegal transition —
 * approving an already-revoked account, revoking a request that was never
 * approved — is rejected by construction rather than by whichever branch
 * happened to be written first.
 */
const ALLOWED_FROM = {
  approve: ["pending"],
  deny: ["pending"],
  revoke: ["active"],
} as const;

/**
 * Approve, deny, or revoke an account.
 *
 * One route because they are one decision from the admin's side, and because a
 * single guarded path is easier to keep correct than three that must each
 * remember the self-check and the token invalidation.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireAdmin();
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "Expected a JSON body.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Unknown action.");
  }
  const { action } = parsed.data;

  if (id === session.user.id) {
    // Blocked here and by a check constraint. With one admin, deciding on your
    // own account locks the product's only operator out of their own product.
    return jsonError("validation_error", "You cannot change your own access.");
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, status: true },
  });

  if (!target) return jsonError("not_found", "No such account.");

  const allowed: readonly string[] = ALLOWED_FROM[action];
  if (!allowed.includes(target.status)) {
    return jsonError(
      "invalid_state_transition",
      `That account cannot be ${action}d from its current state.`,
    );
  }

  const now = new Date();
  const nextStatus =
    action === "approve" ? "active" : action === "deny" ? "denied" : "revoked";

  await prisma.user.update({
    where: { id },
    data: {
      status: nextStatus,
      decidedAt: now,
      decidedById: session.user.id,
      revokedAt: action === "revoke" ? now : null,
    },
  });

  if (action !== "approve") {
    // Best effort. **A failure here does NOT fail the request**: the database
    // write is the authoritative gate, and requireSession denies this account
    // on its next request whether or not the refresh token was invalidated.
    // Rolling back because a token cleanup failed would leave an admin
    // believing access ended when it had not — much the worse outcome.
    try {
      await createAdminClient().auth.admin.signOut(id, "global");
    } catch {
      console.error(
        `Set ${id} to ${nextStatus} in the database, but Supabase token invalidation failed. Access is still denied on the next request.`,
      );
    }
  }

  return Response.json(
    {
      id,
      email: target.email,
      status: nextStatus,
      decidedAt: now.toISOString(),
    },
    { status: 200 },
  );
}
