import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { activeCampaign, engageKillSwitch } from "@/lib/paper/controls";

export const dynamic = "force-dynamic";

/**
 * The kill switch (SIG-63).
 *
 * **No confirmation flow, by design.** Its purpose is to stop first and ask
 * questions later, and a dialog between the operator and a halt is exactly the
 * wrong thing under time pressure. It prevents new autonomous positions and
 * does not delete, close, or force-settle anything.
 *
 * Idempotent: killing an already-killed campaign succeeds rather than erroring,
 * because someone pressing it twice must not see a failure.
 *
 * Admin-only, and the actor comes from the session. No user identifier and no
 * role is ever read from the body — this route takes no body at all.
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

  await engageKillSwitch(campaign.id, session.user.id, new Date());
  return Response.json({ killSwitchEngaged: true }, { status: 200 });
}
