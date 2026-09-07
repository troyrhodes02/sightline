import { z } from "zod";

import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { activeCampaign } from "@/lib/paper/controls";
import { replayEligibility, runReplay } from "@/lib/paper/replay";

export const dynamic = "force-dynamic";

const replayInputSchema = z
  .object({
    periodKind: z.enum(["game_window", "week", "campaign"]),
    periodKey: z.string().min(1),
  })
  .strict();

/**
 * Counterfactual risk-mode replay (SIG-65).
 *
 * Writes only `PaperReplay` and `PaperReplayModeResult`. It touches no ledger
 * entry, no position, no breach, no campaign field and no risk configuration —
 * a superior counterfactual changes nothing at all. Changing risk mode remains
 * a human action taken in Configuration.
 *
 * Refused while any position opened in the period is still open: replaying an
 * unresolved period would compare a finished alternative against an unfinished
 * actual, which is not a comparison.
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

  const parsed = replayInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid replay request.");
  }

  const campaign = await activeCampaign();
  if (!campaign) {
    return jsonError("not_found", "No paper campaign exists.");
  }

  const eligibility = await replayEligibility(
    campaign.id,
    parsed.data.periodKind,
    parsed.data.periodKey,
  );
  if (!eligibility.replayable) {
    return jsonError("invalid_state_transition", eligibility.reason);
  }

  try {
    const result = await runReplay(
      campaign.id,
      parsed.data.periodKind,
      parsed.data.periodKey,
      session.user.id,
      new Date(),
    );
    return Response.json(result, { status: 200 });
  } catch {
    // A failed replay leaves any previously stored replay untouched.
    return jsonError(
      "internal_error",
      "Replay could not complete. No stored replay was changed.",
    );
  }
}
