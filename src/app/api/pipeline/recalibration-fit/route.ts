import { jsonError } from "@/lib/api/errors";
import { verifyPipelineToken } from "@/lib/pipeline/auth";
import {
  recalibrationFitInputSchema,
  runRecalibrationFit,
} from "@/lib/pipeline/recalibration";

export type { PipelineRecalibrationFitResult } from "@/lib/pipeline/recalibration";

export const dynamic = "force-dynamic";

/**
 * Nightly refit of the active probability correction (SIG-61).
 *
 * Machine-authenticated with the scheduler bearer token, not a user session:
 * the caller is a GitHub Actions cron. No user identifier is read from
 * anywhere, and the route has no role.
 *
 * Called unconditionally after grading; the job decides server-side — from
 * stored graded observations and stored backtest records, never the calendar —
 * whether there is anything to fit.
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

  const parsed = recalibrationFitInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid recalibration-fit request.");
  }

  try {
    const result = await runRecalibrationFit(parsed.data);
    return Response.json(result, { status: 200 });
  } catch {
    // Nothing internal reaches the caller: no Prisma text, no connection
    // string, no token.
    return jsonError("internal_error", "The recalibration refit failed.");
  }
}
