import { z } from "zod";

/**
 * Environment configuration, parsed once at module load.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **A missing variable fails at startup, not at first use.** A server that
 *     boots and then throws on the first sign-in attempt is harder to diagnose
 *     than one that refuses to boot.
 *  2. **Server-only values never reach the client.** Anything without the
 *     `NEXT_PUBLIC_` prefix is unreachable from browser code by Next's own
 *     inlining rules; `serverEnv` is additionally guarded below so an accidental
 *     client import fails loudly rather than silently yielding undefined.
 *
 * Kalshi market-data configuration arrives with Pitch 4. The optional key pair
 * below carries MARKET-DATA read access only — no order, portfolio, or balance
 * endpoint exists in this codebase before Pitch 11, and the trading key that
 * pitch introduces is the highest-value secret in the system.
 */

const serverSchema = z.object({
  /** Transaction-pooler connection. Application traffic only. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Direct connection. Prisma Migrate and the Python runtime only. */
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  /** Service-role key. Reachable from exactly one module: lib/supabase/admin. */
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  /**
   * Absolute origin of this deployment.
   *
   * **Optional**, because nothing currently reads it — its only consumer was
   * the invitation link builder, removed with the access-model change. Kept
   * documented for the first surface that needs an absolute URL, but a
   * deployment must not fail to boot over a variable no code touches.
   */
  APP_URL: z.url("APP_URL must be an absolute URL").optional(),

  /**
   * Kalshi trade API v2 base. The default is the production exchange host;
   * point it at the demo host to exercise the integration without touching
   * the live exchange.
   */
  KALSHI_API_BASE_URL: z
    .url("KALSHI_API_BASE_URL must be an absolute URL")
    .default("https://api.elections.kalshi.com/trade-api/v2"),

  /**
   * Optional API key pair for market-data reads (RSA-PSS request signing).
   * Kalshi's market-data GETs are public; a key raises the rate-limit tier.
   * Never logged, never in a response, never sent to a client. **Read access
   * only in this pitch** — nothing here may sign an order (spec RD-18).
   */
  KALSHI_API_KEY_ID: z.string().min(1).optional(),
  KALSHI_PRIVATE_KEY_PEM: z.string().min(1).optional(),

  /** Server-side refresh coalescing window (spec RD-13). */
  KALSHI_SYNC_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(30),

  /** Unchanged books re-observe at most this often (spec RD-14). */
  PRICE_HEARTBEAT_MINUTES: z.coerce.number().int().min(1).default(15),

  /** Confidence-adjusted-edge recommendation threshold, in points (RD-11). */
  RECOMMENDATION_THRESHOLD_POINTS: z.coerce.number().min(0).default(5),

<<<<<<< HEAD
=======
  /** In-page slate polling interval (RD-12). Scheduling proper is Pitch 5. */
  SLATE_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),

>>>>>>> feat/SIG-43-slate-ui
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

/** Any environment-shaped bag. Deliberately looser than NodeJS.ProcessEnv,
 * which insists on NODE_ENV and makes every test fixture a cast. */
export type EnvSource = Record<string, string | undefined>;

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

function format(error: z.ZodError): string {
  const lines = error.issues.map(
    (i) => `  - ${i.path.join(".")}: ${i.message}`,
  );
  return `Invalid environment configuration:\n${lines.join("\n")}`;
}

/** Parses the server environment. Exported for tests; prefer `serverEnv`. */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) throw new Error(format(result.error));
  return result.data;
}

/** Parses the public environment. Exported for tests; prefer `clientEnv`. */
export function parseClientEnv(source: EnvSource): ClientEnv {
  const result = clientSchema.safeParse(source);
  if (!result.success) throw new Error(format(result.error));
  return result.data;
}

// Next inlines NEXT_PUBLIC_* by literal reference, so these cannot be read from
// a computed key on the client. Reference them explicitly.
export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

let cachedServerEnv: ServerEnv | undefined;

/**
 * Server-only configuration. Throws if reached from browser code rather than
 * returning a half-populated object.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called from client code.");
  }
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}
