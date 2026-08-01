import { cookies } from "next/headers";
import { createServerClient as createSSRClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/env";

/**
 * The cookie-backed Supabase client for server components and route handlers.
 *
 * Uses the **anon** key and therefore carries only the caller's own privileges.
 * It answers "who signed in"; it does not answer "are they still allowed in" —
 * that is a Postgres read, and it lands with `requireSession` in SIG-32.
 */
export async function createServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createSSRClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. The middleware refreshes the
            // session instead, so swallowing here is correct rather than lossy.
          }
        },
      },
    },
  );
}
