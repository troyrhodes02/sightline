import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
// Creating the auth user is one of the sanctioned uses of the service-role
// client. See src/lib/supabase/admin.ts and the structural test that tracks it.
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    email: z.email("Enter a valid email address.").max(320),
    password: z.string().min(12, "Use at least 12 characters.").max(512),
    confirmPassword: z.string().min(1),
    displayName: z.string().trim().max(80).optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  // Role is never client-supplied. A body carrying one is an attempt to
  // self-assign admin, not a value to reason about.
  .strict();

/**
 * The single, uniform answer to a sign-up attempt.
 *
 * **Returned whether or not the address already has an account.** Sign-up is a
 * public surface, so a distinct "already registered" reply would let anyone
 * enumerate who is in the group — the same private information the access model
 * exists to protect. The request either creates a pending row or quietly does
 * nothing, and the caller cannot tell which.
 */
const SUBMITTED =
  "Your request has been submitted. You will be able to sign in once an admin approves it.";

const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Requests an account.
 *
 * Creates a `pending` row and nothing else: **no access is granted here**, and
 * the caller is not signed in. `requireSession` rejects a pending account on
 * every protected surface, so a row is a request rather than a user.
 *
 * Ordering mirrors the rest of the application. The Supabase auth user is a
 * remote call and cannot join a Prisma transaction, so it is created first and
 * **deleted if the row write fails** — an orphaned auth user can authenticate,
 * be rejected forever, and appear on no admin surface.
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
      [String(first?.path[0] ?? "email")]: first?.message ?? "Invalid value.",
    });
  }

  const { password, displayName } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  // Keyed on the address so one attacker cannot exhaust everyone's budget, and
  // a rejection carries the same message as a success for the same reason the
  // duplicate case does.
  if (
    !rateLimit(`sign-up:${email}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS).allowed
  ) {
    return Response.json({ message: SUBMITTED }, { status: 202 });
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    // Same body, same status, no row written. The caller learns nothing.
    return Response.json({ message: SUBMITTED }, { status: 202 });
  }

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation flow; approval is the gate
  });

  if (created.error || !created.data.user) {
    // Most often the address already exists in auth without a users row.
    // Indistinguishable from success, deliberately.
    return Response.json({ message: SUBMITTED }, { status: 202 });
  }

  try {
    await prisma.user.create({
      data: {
        id: created.data.user.id, // the auth UUID IS the primary key
        email,
        displayName: displayName?.length ? displayName : null,
        role: "viewer",
        status: "pending",
      },
    });
  } catch {
    await admin.auth.admin.deleteUser(created.data.user.id).catch(() => {
      // Nothing further to do from here, and surfacing the provider's message
      // would leak internals to an anonymous caller.
    });
    return jsonError(
      "internal_error",
      "Your request could not be submitted. Try again in a moment.",
    );
  }

  return Response.json({ message: SUBMITTED }, { status: 202 });
}
