import { jsonError } from "@/lib/api/errors";
import { verifyPipelineToken } from "@/lib/pipeline/auth";
import {
  outcomeIngestInputSchema,
  runOutcomeIngest,
} from "@/lib/pipeline/outcome-ingest";

export type { PipelineOutcomeIngestResult } from "@/lib/pipeline/outcome-ingest";

export const dynamic = "force-dynamic";

/**
 * Scheduled Kalshi settlement ingest (Outcome Scoring & Accuracy Surface,
 * spec §10). The hourly cron calls this unconditionally; the ingest decides
 * server-side — from the stored schedule and outcome state, never the
 * calendar — whether Kalshi is actually contacted.
 *
 * Machine-authenticated: scheduler bearer token, not a user session. No user
 * identifier is read from anywhere. A Kalshi outage stays the designed
 * degraded mode — recorded on the pipeline run, answered with 200, never a
 * 5xx.
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

  const parsed = outcomeIngestInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid outcome-ingest request.");
  }

  try {
    const result = await runOutcomeIngest(parsed.data);
    return Response.json(result, { status: 200 });
  } catch {
    // Unexpected only — Kalshi failures are the designed degraded 200.
    // Nothing internal reaches the caller.
    return jsonError("internal_error", "The scheduled outcome ingest failed.");
  }
}
