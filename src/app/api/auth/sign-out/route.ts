import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Clears the session.
 *
 * Not treated as destructive and carries no confirmation — signing out loses
 * nothing. It also does not fail: if the provider call errors, the cookies are
 * still cleared locally and the caller still lands signed out, which is the
 * outcome they asked for.
 */
export async function POST(): Promise<Response> {
  const supabase = await createServerClient();

  try {
    await supabase.auth.signOut();
  } catch {
    // Intentionally swallowed — see above.
  }

  return Response.json({ redirectTo: "/sign-in" }, { status: 200 });
}
