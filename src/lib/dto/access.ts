/**
 * One row of the Users screen — either a pending request or a current member.
 *
 * `null` is carried as `null`. The component renders the dash. A DTO that
 * carried `"—"` would make a missing value indistinguishable from a present
 * one, and this screen is where that distinction matters.
 */
export type AccessRowDto = {
  id: string;
  displayName: string | null;
  email: string;
  role: "admin" | "viewer";
  /** `pending` in the request queue; `active` in the roster. */
  status: "pending" | "active" | "denied" | "revoked";
  /** ISO timestamp of the sign-up. */
  requestedAt: string;
  /** ISO timestamp, or null when the account has never been used. */
  lastActiveAt: string | null;
  /** Suppresses the revoke control. The server and a check constraint block it too. */
  isSelf: boolean;
};
