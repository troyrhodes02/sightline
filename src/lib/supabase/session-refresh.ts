import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { clientEnv } from "@/env";

/**
 * Refreshes the Supabase session cookie on a request.
 *
 * **This is not an authorization boundary and must never become one.** It
 * exists so a long-lived refresh token keeps producing fresh access tokens
 * without the user signing in again. It performs no role check, gates no route,
 * and reads nothing from Postgres.
 *
 * If this file were deleted, the application would still be secure — sessions
 * would merely expire sooner. That property is the point: every protected
 * surface independently resolves the session and re-reads `users.status`
 * (SIG-32), so nothing depends on middleware having run.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching the user is what triggers the refresh. The result is deliberately
  // discarded — deciding anything from it here would make this a boundary.
  await supabase.auth.getUser();

  return response;
}
