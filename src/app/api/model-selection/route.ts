import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import {
  ModelSelectionError,
  applyModelSelection,
  modelSelectionInputSchema,
} from "@/lib/paper/model-selection";

export const dynamic = "force-dynamic";

/**
 * `POST /api/model-selection` — the ONLY production-config mutation in Parallel
 * Model Evaluation (PME-6, D12/D13).
 *
 * Every other recommendation / leader / readiness surface is read-only with
 * respect to production configuration; this route is the one place a human,
 * confirmed action changes the active model for a stat. It:
 *
 *  - requires an admin session (viewer → 403), reading the actor from the
 *    session and never from the body;
 *  - requires an explicit `confirmed: true` (the UI Dialog restates the
 *    outgoing/incoming model and the readiness-reset consequence). The strict
 *    schema rejects a body carrying a userId or role, and refuses an
 *    unconfirmed request;
 *  - rejects a Simulation selection for a stat it does not price
 *    (`invalid_model_for_stat`);
 *  - and, on success, resets the newly-active configuration's own portfolio
 *    readiness clock (D2) — all inside `applyModelSelection`'s transaction.
 *
 * No leader, recommendation, or readiness value is read here: the human's
 * explicit choice is the entire input.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return jsonError("forbidden", "Not available.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "The request body is not JSON.");
  }

  const parsed = modelSelectionInputSchema.safeParse(body);
  if (!parsed.success) {
    // A missing/false `confirmed` is the confirmation gate; anything else is a
    // shape error. Both surface as validation_error with the specific code in
    // details, since the shared API vocabulary has no dedicated codes for them.
    const confirmationMissing = parsed.error.issues.some((issue) =>
      issue.path.includes("confirmed"),
    );
    return jsonError(
      "validation_error",
      confirmationMissing
        ? "Model selection requires an explicit confirmation."
        : "Expected { statType, modelVersion, confirmed } and nothing else.",
      { code: confirmationMissing ? "confirmation_required" : "invalid_input" },
    );
  }

  try {
    const result = await applyModelSelection({
      statType: parsed.data.statType,
      modelVersion: parsed.data.modelVersion,
      actorUserId: session.user.id,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ModelSelectionError) {
      if (error.code === "no_campaign") {
        return jsonError("not_found", "No paper campaign exists.");
      }
      return jsonError("validation_error", error.message, {
        code: error.code,
      });
    }
    return jsonError(
      "internal_error",
      "The model selection could not be saved.",
    );
  }
}
