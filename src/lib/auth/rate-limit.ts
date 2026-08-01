import "server-only";

/**
 * A fixed-window rate limiter, in memory.
 *
 * **Deliberately not infrastructure.** Sightline has three users and no Redis;
 * `CLAUDE.md` rules out adding a caching layer, and a limiter backed by one
 * would be more moving parts than the thing it protects.
 *
 * The honest limitation: serverless instances do not share memory, so the
 * effective limit is per-instance rather than global. That is acceptable here
 * because this is a speed bump against credential stuffing on a closed system
 * with a handful of accounts, not a defence against a distributed attack. If it
 * ever needs to be one, it needs a store, and that is a pitch.
 *
 * **Keys are attacker-chosen.** Sign-up is public, so anyone can mint a new
 * window by posting a new address. Without eviction the map would grow for the
 * life of the instance under input nobody controls, so expired windows are
 * swept opportunistically below — the map only ever holds live ones.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/**
 * Sweep only once the map is large enough for it to be worth the walk. Below
 * this the cost of scanning outweighs the memory it would reclaim.
 */
const SWEEP_THRESHOLD = 1_000;

function sweepExpired(now: number): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  // Amortised: O(n) at most once per SWEEP_THRESHOLD insertions, and only ever
  // removing windows that have already lapsed.
  if (windows.size >= SWEEP_THRESHOLD) sweepExpired(now);

  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam. Never called by application code. */
export function resetRateLimits(): void {
  windows.clear();
}
