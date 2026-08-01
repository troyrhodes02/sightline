import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api/errors";
import { hashInvitationToken } from "@/lib/auth/tokens";
import { resolveInvitationState } from "@/lib/auth/invitation-state";
import { createServerClient } from "@/lib/supabase/server";
// SIG-34: creating the auth user is one of exactly two sanctioned uses of the
// service-role client. See src/lib/supabase/admin.ts and the structural test
// that tracks its importers.
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    token: z.string().min(1).max(256),
    password: z.string().min(12, "Use at least 12 characters.").max(512),
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  // The invitation determines the address and the role. A body supplying either
  // is not a value to reason about — it is an attempt to self-assign a role.
  .strict();

/**
 * Accepts an invitation. **The only path that creates a `User`.**
 *
 * It spans two systems, so the ordering is load-bearing:
 *
 *  1. Resolve and validate — cheap, and leaves nothing behind on failure.
 *  2. Create the Supabase auth user. This is a remote call and **cannot join a
 *     Prisma transaction**, which is the whole difficulty here.
 *  3. In one transaction: create the `User` row and mark the invitation used.
 *  4. If step 3 fails, **delete the auth user from step 2.** An orphaned auth
 *     user can sign in, get rejected by `requireSession` forever, and appears
 *     on no admin surface — a soft-bricked account nobody can see or fix.
 *
 * The token is consumed only on success. A failed attempt leaves it valid.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "Expected a JSON body.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError("validation_error", "Check the details and try again.", {
      [String(first?.path[0] ?? "password")]:
        first?.message ?? "Invalid value.",
    });
  }

  const { token, password } = parsed.data;

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      displayName: true,
      createdAt: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  const state = resolveInvitationState(invitation, new Date());
  if (state !== "valid" || !invitation) {
    // The state is returned so the page can render the right copy. It reveals
    // nothing — the caller already holds the token this refers to.
    return jsonError(
      "invalid_state_transition",
      "This invitation cannot be used.",
      { state },
    );
  }

  const admin = createAdminClient();

  const created = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true, // the token IS the proof of address ownership
  });

  if (created.error || !created.data.user) {
    return jsonError(
      "upstream_unavailable",
      "Account setup failed. Try again in a moment.",
    );
  }

  const authUserId = created.data.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: authUserId, // the auth UUID IS the primary key
          email: invitation.email,
          displayName: invitation.displayName,
          role: invitation.role,
          invitedAt: invitation.createdAt,
          acceptedAt: new Date(),
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedUserId: authUserId },
      });
    });
  } catch {
    // Undo step 2. See the note above on orphaned auth users.
    await admin.auth.admin.deleteUser(authUserId).catch(() => {
      // If this also fails there is nothing further to do from here, and
      // surfacing the provider's message would leak internals to the invitee.
    });

    return jsonError(
      "internal_error",
      "Account setup failed. Try again in a moment.",
    );
  }

  // Sign them in so they land on the slate rather than being sent to type the
  // password they just chose.
  const supabase = await createServerClient();
  await supabase.auth.signInWithPassword({
    email: invitation.email,
    password,
  });

  return Response.json({ redirectTo: "/slate" }, { status: 201 });
}
