import { jsonError } from "@/lib/api/errors";
import { verifyPipelineToken } from "@/lib/pipeline/auth";
import {
  actedAtIsPlausible,
  keepaliveInputSchema,
  recordKeepalive,
} from "@/lib/pipeline/keepalive";

export const dynamic = "force-dynamic";

/**
 * The keepalive self-report (RD-Q11): called by the monthly workflow after it
 * commits the marker file, so offseason readiness is observable on `/health`.
 * Machine-authenticated; records one `PipelineRun` per logical action, born
 * terminal. Duplicate delivery returns the existing recording (idempotent).
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

  const parsed = keepaliveInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid keepalive report.");
  }
  if (!actedAtIsPlausible(parsed.data.actedAt, new Date())) {
    return jsonError("validation_error", "actedAt is in the future.");
  }

  try {
    const result = await recordKeepalive(parsed.data);
    return Response.json(result, { status: 200 });
  } catch {
    return jsonError("internal_error", "The keepalive could not be recorded.");
  }
}
