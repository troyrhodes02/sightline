export type InvitationState =
  "valid" | "expired" | "used" | "revoked" | "invalid";

/** The subset of an `Invitation` this resolver needs. */
export type InvitationLifecycle = {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

/**
 * Resolves an invitation's lifecycle state.
 *
 * **Derived, never stored.** A status column would drift the moment expiry
 * passed with no write to observe it, leaving the database confidently wrong.
 *
 * **The precedence is fixed and load-bearing.** Revocation outranks expiry, so
 * a link the admin deliberately killed never reads as merely lapsed — the two
 * states carry different meanings for the recipient, and conflating them tells
 * someone their invitation timed out when in fact their access was withdrawn.
 * Acceptance outranks expiry for the same reason: an accepted invitation whose
 * window has since passed is used, not expired.
 */
export function resolveInvitationState(
  invitation: InvitationLifecycle | null,
  now: Date,
): InvitationState {
  if (invitation === null) return "invalid"; // unknown or malformed token
  if (invitation.revokedAt !== null) return "revoked";
  if (invitation.acceptedAt !== null) return "used";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}
