import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/env";

/**
 * Scheduler authentication for the `/api/pipeline/*` namespace (RD-20).
 *
 * A dedicated bearer token, not a user session: the caller is a GitHub
 * Actions cron, and mixing machine auth into the session routes invites
 * regressions in both directions. The token authorizes a price refresh and a
 * keepalive report — it cannot read slate data, cannot write decisions, and
 * has no role.
 */

export type PipelineAuthResult = "ok" | "unauthorized" | "unconfigured";

/**
 * Verifies the `Authorization: Bearer …` header against the configured token.
 *
 * Comparison is constant-time over SHA-256 digests: hashing first equalises
 * length so `timingSafeEqual` is usable, and the comparison cost is
 * independent of where the strings first differ.
 */
export function verifyPipelineToken(
  authorizationHeader: string | null,
  configuredToken: string | undefined = serverEnv().PIPELINE_SCHEDULER_TOKEN,
): PipelineAuthResult {
  if (!configuredToken) return "unconfigured";

  const match = authorizationHeader?.match(/^Bearer (.+)$/);
  if (!match) return "unauthorized";

  const presented = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(configuredToken).digest();
  return timingSafeEqual(presented, expected) ? "ok" : "unauthorized";
}
