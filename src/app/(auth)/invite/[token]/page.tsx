import { prisma } from "@/lib/prisma";
import { hashInvitationToken } from "@/lib/auth/tokens";
import { resolveInvitationState } from "@/lib/auth/invitation-state";
import { InviteAcceptance } from "@/components/screens/InviteAcceptance";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Invitation · Sightline",
  // The token is in the URL. Keep it out of referrers and out of any index.
  robots: { index: false, follow: false },
};

/**
 * Resolves the invitation server-side before rendering, so the invitee never
 * sees a form that then turns out to be invalid.
 *
 * Only the `valid` branch carries data. The four failure branches pass nothing
 * — not the email, not the role, not the expiry — because a failed invitation
 * page must not confirm that an address was ever invited.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      email: true,
      role: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  const state = resolveInvitationState(invitation, new Date());

  if (invitation === null || state === "invalid") {
    return <InviteAcceptance state="invalid" />;
  }
  if (state !== "valid") {
    return <InviteAcceptance state={state} />;
  }

  return (
    <InviteAcceptance
      state="valid"
      token={token}
      email={invitation.email}
      role={invitation.role}
    />
  );
}
