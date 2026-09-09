import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { activeCampaign, releaseKillSwitch } from "@/lib/paper/controls";
import { breachedConditions, readCampaignState } from "@/lib/paper/state";

export const dynamic = "force-dynamic";

/**
 * Disengage the kill switch (SIG-63).
 *
 * Releasing does NOT clear a breaker. If a safety condition is still breached
 * the campaign stays halted, and the response says so — the kill switch and the
 * breakers are separate safeties, and disengaging one must not silently
 * disengage the other.
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

  await releaseKillSwitch(campaign.id, session.user.id, new Date());

  const state = await readCampaignState();
  const stillBreached = state ? [...breachedConditions(state)] : [];
  return Response.json(
    { killSwitchEngaged: false, stillBreached },
    { status: 200 },
  );
}
