import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import {
  ControlStateError,
  activeCampaign,
  resume,
} from "@/lib/paper/controls";
import { breachedConditions, readCampaignState } from "@/lib/paper/state";

export const dynamic = "force-dynamic";

/**
 * Ordinary Resume (SIG-63).
 *
 * Permitted only when every halting condition has CLEARED, judged by a fresh
 * evaluation rather than by the stored rows. While anything is still breached
 * the operator must use Force Override instead, which records that the bot
 * wanted to stop and was overruled — the fact the audit trail exists to keep.
 */
export async function POST(): Promise<Response> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return jsonError("forbidden", "Not available.");
  }

  const campaign = await activeCampaign();
  if (!campaign) {
    return jsonError("not_found", "No paper campaign exists.");
  }

  const state = await readCampaignState();
  if (!state) {
    return jsonError("not_found", "No paper campaign exists.");
  }

  try {
    await resume(
      campaign.id,
      session.user.id,
      breachedConditions(state),
      new Date(),
    );
  } catch (error) {
    if (error instanceof ControlStateError) {
      return jsonError("invalid_state_transition", error.message);
    }
    throw error;
  }

  return Response.json({ resumed: true }, { status: 200 });
}
