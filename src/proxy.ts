import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session-refresh";

/**
 * Session-cookie refresh only. **Not the authorization boundary.**
 *
 * Every protected surface calls its own guard and re-reads `users.status` from
 * Postgres, because an access token minted before revocation still verifies and
 * still carries a role claim. A role check here would be redundant at best and,
 * if anything ever came to rely on it, a way for a cached response to serve a
 * revoked user.
 *
 * Named `proxy.ts` rather than `middleware.ts`: Next.js 16 deprecated the
 * middleware file convention in favour of this one. The spec calls this file
 * `src/middleware.ts`, written before the framework moved.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation, which carry no
    // session and would only add latency.
    "/((?!_next/static|_next/image|favicon.svg|apple-touch-icon.png|icons/).*)",
  ],
};
