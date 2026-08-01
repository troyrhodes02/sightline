import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens.
 *
 * **The plaintext exists in exactly two places** — the outbound email and the
 * URL the recipient clicks. Never in the database, never in a log line, never
 * in a response body, never in a DTO. The database holds a SHA-256 hash, which
 * is enough to look a token up and useless to anyone who reads the table.
 *
 * SHA-256 rather than a password hash on purpose: this is a 256-bit random
 * value, not a human-chosen secret, so there is nothing to brute-force and no
 * reason to pay bcrypt's cost on every acceptance. The threat a slow hash
 * defends against — a dictionary attack on low-entropy input — does not exist
 * here.
 */

const TOKEN_BYTES = 32;

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hashes.
 *
 * Lookup is by indexed hash rather than by scanning, so this is not on the hot
 * path — it exists for the places that compare a computed hash to a stored one
 * directly.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
