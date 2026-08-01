/**
 * One row of the Users list.
 *
 * The list is a **union of accepted users and pending invitations**, which is
 * why several fields are nullable — a pending invitation has no account behind
 * it yet, so no name and no activity.
 *
 * `null` is carried as `null`. The component renders the dash. A DTO that
 * carried `"—"` would make a missing value indistinguishable from a present
 * one, and this screen is where that distinction matters.
 */
export type AccessRowDto = {
  /** A `User` id, or an `Invitation` id when pending. */
  id: string;
  kind: "user" | "invitation";
  displayName: string | null;
  email: string;
  role: "admin" | "viewer";
  /** ISO date, rendered as a date. */
  invitedAt: string;
  /** ISO timestamp, or null when the account has never been used. */
  lastActiveAt: string | null;
  pending: boolean;
  /** Suppresses the revoke control. The server blocks it too. */
  isSelf: boolean;
};
