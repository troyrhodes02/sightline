import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { hasAccess, STATUS_MESSAGE } from "@/lib/auth/account-status";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(512),
  // Where the caller was headed before being bounced to sign-in. Path-only, so
  // a crafted absolute URL cannot turn this into an open redirect.
  redirectTo: z
    .string()
    .regex(/^\/(?!\/)[\w\-./]*$/, "redirectTo must be a relative path")
    .optional(),
});

/**
 * The single opaque failure. **Unknown email, wrong password, and revoked
 * account must be indistinguishable** — same status, same code, same message,
 * and the same amount of work done before replying.
 *
 * Anything else turns this endpoint into an account-existence oracle, which on
 * an invite-only product tells an attacker who is in the group.
 */
const CREDENTIALS_REJECTED = "Email or password is incorrect.";

const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "Expected a JSON body.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Still opaque: a shape complaint here would reveal which field was wrong.
    return jsonError("unauthorized", CREDENTIALS_REJECTED);
  }

  const { email, password, redirectTo } = parsed.data;
  const key = `sign-in:${email.toLowerCase()}`;

  const limit = rateLimit(key, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
  if (!limit.allowed) {
    // Carries the same message as a credential failure on purpose — a distinct
    // one would confirm the address is worth rate-limiting.
    return jsonError("rate_limited", CREDENTIALS_REJECTED);
  }

  const supabase = await createServerClient();

  let signIn;
  try {
    signIn = await supabase.auth.signInWithPassword({ email, password });
  } catch {
    return jsonError(
      "upstream_unavailable",
      "Sign-in is unavailable right now. Try again in a moment.",
    );
  }

  if (signIn.error || !signIn.data.user) {
    // A provider outage is distinguishable from bad credentials, and must be:
    // someone who typed the right password should never be told they did not.
    // Supabase reports outages as 5xx and credential failures as 400.
    const status = signIn.error?.status ?? 400;
    if (status >= 500) {
      return jsonError(
        "upstream_unavailable",
        "Sign-in is unavailable right now. Try again in a moment.",
      );
    }
    return jsonError("unauthorized", CREDENTIALS_REJECTED);
  }

  // Authentication succeeded. Authorization has not been checked yet — the
  // token proves who they are, the database says whether they may enter.
  const user = await prisma.user.findUnique({
    where: { id: signIn.data.user.id },
    select: { status: true },
  });

  if (!user) {
    // An auth user with no row: a half-completed sign-up. Opaque, because from
    // outside it is indistinguishable from an address that never registered.
    await supabase.auth.signOut();
    return jsonError("unauthorized", CREDENTIALS_REJECTED);
  }

  if (!hasAccess(user.status)) {
    // Tear the session down, then say WHICH of the three it is.
    //
    // Safe to be specific here and only here: they supplied the correct
    // password, so they already own the address and learn nothing they could
    // not have learned by owning it. Someone guessing never reaches this branch
    // — a wrong password returns the opaque message above.
    await supabase.auth.signOut();
    return jsonError("forbidden", STATUS_MESSAGE[user.status], {
      status: user.status,
    });
  }

  return Response.json({ redirectTo: redirectTo ?? "/slate" }, { status: 200 });
}
