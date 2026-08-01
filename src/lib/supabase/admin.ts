import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv, serverEnv } from "@/env";

/**
 * The service-role Supabase client. **The only module in the application
 * permitted to hold this key.**
 *
 * It bypasses every Supabase-side check, so its blast radius is the whole auth
 * schema. Two call sites exist across the entire milestone, both server-side:
 *
 *   - invitation acceptance, which creates the auth user (SIG-34)
 *   - revocation, which invalidates refresh tokens (SIG-36)
 *
 * The `server-only` import above turns an accidental client-component import
 * into a build error rather than a leaked key. An ESLint rule additionally
 * restricts who may import this module at all — belt and braces, deliberately,
 * because the failure mode here is not recoverable.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
