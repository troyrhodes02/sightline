import { jsonError } from "@/lib/api/errors";
import { verifyPipelineToken } from "@/lib/pipeline/auth";
import {
  paperCycleInputSchema,
  runPaperCycle,
} from "@/lib/pipeline/paper-cycle";

export type { PipelinePaperCycleResult } from "@/lib/pipeline/paper-cycle";

export const dynamic = "force-dynamic";

/**
 * The scheduled autonomous paper cycle (SIG-63).
 *
 * Machine-authenticated with the scheduler bearer token, not a user session.
 * The cron calls this unconditionally every ten minutes; the job decides
 * server-side — from the stored schedule and stored campaign state, never the
 * calendar — whether any game window is evaluated.
 *
 * A Kalshi outage is a designed degraded state: 200 with `degraded: true`, the
 * cycle recorded as failed, and no position created. It is never a 5xx.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = verifyPipelineToken(request.headers.get("authorization"));
  if (auth === "unconfigured") {
    return jsonError(
      "upstream_unavailable",
      "The scheduler token is not configured.",
    );
  }
  if (auth === "unauthorized") {
    return jsonError("unauthorized", "Invalid scheduler credentials.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "The request body is not JSON.");
  }

  const parsed = paperCycleInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid paper-cycle request.");
  }

  try {
    const result = await runPaperCycle(parsed.data);
    return Response.json(result, { status: 200 });
  } catch {
    // Unexpected only — Kalshi failures are the designed degraded 200. Nothing
    // internal reaches the caller.
    return jsonError("internal_error", "The autonomous paper cycle failed.");
  }
}
