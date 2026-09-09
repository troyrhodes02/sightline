import { z } from "zod";

import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { activeCampaign } from "@/lib/paper/controls";
import { replayEligibility, runReplay } from "@/lib/paper/replay";

export const dynamic = "force-dynamic";

// The period key is parsed downstream by `new Date(key)` for a game window and
// `Number(key.split("-w")[...])` for a week, so a shape check here is the only
// thing standing between a typo and `Invalid Date` / `NaN` reaching Prisma.
const replayInputSchema = z.discriminatedUnion("periodKind", [
  z
    .object({
      periodKind: z.literal("game_window"),
      periodKey: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      periodKind: z.literal("week"),
      periodKey: z.string().regex(/^\d{4}-w\d{1,2}$/),
    })
    .strict(),
  z
    .object({
      periodKind: z.literal("campaign"),
      periodKey: z.literal("campaign"),
    })
    .strict(),
]);

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

  // Inside the try, with the run itself. Eligibility reads the same period key
  // the replay does, so anything that could throw out of the replay could throw
  // out of the check — and above the try it would escape as a raw error rather
  // than the sanitised response every other path here is careful to return.
  try {
    const eligibility = await replayEligibility(
      campaign.id,
      parsed.data.periodKind,
      parsed.data.periodKey,
    );
    if (!eligibility.replayable) {
      return jsonError("invalid_state_transition", eligibility.reason);
    }

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
