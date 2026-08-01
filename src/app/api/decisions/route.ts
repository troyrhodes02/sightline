import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";
import {
  ContractNotFoundError,
  DecisionClosedError,
  recordDecision,
  toDecisionDto,
} from "@/lib/decisions/record";

export const dynamic = "force-dynamic";

/**
 * The decision write — admin-only, and the body carries the contract and the
 * disposition, NOTHING else. `.strict()` makes a body with snapshot-like
 * fields a validation error rather than a value to trust: the decision-time
 * snapshot is read server-side inside `recordDecision`, and the user identity
 * comes from the session.
 */
const schema = z
  .object({
    contractId: z.uuid(),
    disposition: z.enum(["took", "faded", "skipped"]),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const session = await requireAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "Expected a JSON body.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "validation_error",
      "Expected { contractId, disposition } and nothing else.",
    );
  }

  try {
    const result = await recordDecision({
      contractId: parsed.data.contractId,
      disposition: parsed.data.disposition,
      userId: session.user.id,
    });

    if (result.unchanged) {
      return Response.json(
        { decision: toDecisionDto(result.decision) },
        { status: 200 },
      );
    }

    return Response.json(
      {
        decision: toDecisionDto(result.decision),
        ...(result.superseded
          ? {
              warnings: [
                {
                  code: "existing_decision",
                  message:
                    "A decision already existed on this contract. This one supersedes it; the prior record is preserved.",
                },
              ],
            }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ContractNotFoundError) {
      return jsonError("not_found", "No such contract.");
    }
    if (error instanceof DecisionClosedError) {
      return jsonError(
        "invalid_state_transition",
        "This game has started. Decisions are closed.",
      );
    }
    return jsonError("internal_error", "The decision was not saved.");
  }
}
