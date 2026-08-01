/**
 * The mail port.
 *
 * An interface rather than a direct Resend call so the provider is a one-file
 * change, and so local development never needs an API key or a real inbox.
 * Resend is a new dependency adopted under the spec's Resolved Decisions #5;
 * the Architecture Doc's Tech Stack should record it.
 */
export type InvitationEmail = {
  to: string;
  acceptUrl: string;
  role: "admin" | "viewer";
  displayName: string | null;
};

export interface InvitationMailer {
  send(email: InvitationEmail): Promise<void>;
}
