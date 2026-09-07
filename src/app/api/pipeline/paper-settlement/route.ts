import { jsonError } from "@/lib/api/errors";
import { verifyPipelineToken } from "@/lib/pipeline/auth";
import {
  paperSettlementInputSchema,
  runPaperSettlement,
} from "@/lib/pipeline/paper-settlement";

export type { PipelinePaperSettlementResult } from "@/lib/pipeline/paper-settlement";

export const dynamic = "force-dynamic";

/**
 * The scheduled paper settlement pass (SIG-63).
 *
 * Settles open positions against stored Kalshi settlements, advances the
 * high-water mark, runs the withdrawal ratchet, and re-evaluates every breaker.
 * Contacts no external service: settlement arrives through outcome ingest, so
 * this pass reads only what is already stored.
 *
 * Runs regardless of whether the campaign is halted or killed. A safety stop
 * prevents new positions; it is not a reason to leave existing ones unresolved.
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

  const parsed = paperSettlementInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid paper-settlement request.");
  }

  try {
    const result = await runPaperSettlement(parsed.data);
    return Response.json(result, { status: 200 });
  } catch {
    return jsonError("internal_error", "The paper settlement pass failed.");
  }
}
