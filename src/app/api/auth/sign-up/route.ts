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
 * Ceiling on outstanding requests.
 *
 * The per-address limit above stops one person retrying; it does nothing about
 * one script submitting a thousand *different* addresses, each of which would
 * create a Supabase auth user and a row in the admin's queue. This bounds that.
 *
 * Generous for a product with a handful of accounts, and the admin empties the
 * queue by approving or denying — so hitting it means either genuine interest
 * worth looking at, or abuse worth noticing.
 */
const MAX_PENDING_REQUESTS = 100;

/**
 * Floor on how long a sign-up takes to answer.
 *
 * The response body is uniform by design, but the *paths* are not: a registered
 * address returns after one local read, while a new one waits on a remote
 * Supabase call. That difference is measurable from anywhere and re-opens the
 * enumeration the uniform body exists to close, so every path is padded to the
 * same floor.
 *
 * Set above the slowest normal path rather than tuned tightly — the point is
 * that the *variance* stops carrying information, not that the number is exact.
 */
const RESPONSE_FLOOR_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  // Every branch below returns the same body. `settle` also holds each of them
  // to the same floor, so the response reveals nothing by shape OR by timing.
  const startedAt = Date.now();
  const settle = async (): Promise<Response> => {
    await sleep(Math.max(0, RESPONSE_FLOOR_MS - (Date.now() - startedAt)));
    return Response.json({ message: SUBMITTED }, { status: 202 });
  };

  // Keyed on the address so one attacker cannot exhaust everyone's budget.
  if (
    !rateLimit(`sign-up:${email}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS).allowed
  ) {
    return settle();
  }

  // Bounds the queue, the Supabase project, and the rate-limiter's key space
  // against a script cycling through addresses. Counted rather than trusted.
  const pendingCount = await prisma.user.count({
    where: { status: "pending" },
  });
  if (pendingCount >= MAX_PENDING_REQUESTS) {
    console.warn(
      `Sign-up refused: ${pendingCount} requests already pending (ceiling ${MAX_PENDING_REQUESTS}).`,
    );
    return settle();
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    // Same body, same status, same elapsed time, and no row written. This
    // covers denied and revoked accounts too: both are terminal per the spec,
    // so a fresh request changes nothing. Reinstatement is a manual database
    // change by design, not a self-serve path.
    return settle();
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
    return settle();
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

  return settle();
}
