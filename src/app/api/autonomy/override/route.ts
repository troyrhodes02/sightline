import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { z } from "zod";
import {
  ControlStateError,
  activeCampaign,
  forceOverride,
} from "@/lib/paper/controls";
import { breachedConditions, readCampaignState } from "@/lib/paper/state";

export const dynamic = "force-dynamic";

const overrideInputSchema = z
  .object({
    breachIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

/**
 * Force Override (SIG-63): resume while a condition is still breached.
 *
 * Every active halting condition must be named. A partial override is not a
 * state the system can be in — the unacknowledged condition would keep it
 * halted while the record claimed the operator had accepted everything.
 *
 * Refused while the kill switch is engaged, and refused if a named condition
 * has cleared since the page was loaded: overriding something no longer
 * breached would put a false record in the audit trail.
 *
 * The override does not disable the breaker. The condition is evaluated again
 * on the very next cycle and may open a new row.
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

  const parsed = overrideInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "validation_error",
      "Name every active safety condition you are overriding.",
    );
  }

  const campaign = await activeCampaign();
  const state = await readCampaignState();
  if (!campaign || !state) {
    return jsonError("not_found", "No paper campaign exists.");
  }

  try {
    await forceOverride(
      campaign.id,
      session.user.id,
      parsed.data.breachIds,
      breachedConditions(state),
      new Date(),
    );
  } catch (error) {
    if (error instanceof ControlStateError) {
      return jsonError("invalid_state_transition", error.message);
    }
    throw error;
  }

  return Response.json(
    { overridden: parsed.data.breachIds.length },
    { status: 200 },
  );
}
