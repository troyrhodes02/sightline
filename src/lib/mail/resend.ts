import "server-only";

import { Resend } from "resend";
import type { InvitationEmail, InvitationMailer } from "./types";
import { renderInvitationEmail } from "./invitation-email";

/**
 * Preview and production transport.
 *
 * A send failure must **throw**, not swallow: the route rolls the invitation
 * row back when it does. A stored invitation whose link was never delivered is
 * unrecoverable — the plaintext cannot be regenerated from the hash, and there
 * is no resend in this pitch.
 */
export class ResendInvitationMailer implements InvitationMailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: InvitationEmail): Promise<void> {
    const { subject, html, text } = renderInvitationEmail(email);
    const resend = new Resend(this.apiKey);

    const { error } = await resend.emails.send({
      from: this.from,
      to: email.to,
      subject,
      html,
      text,
    });

    // Deliberately does not include the provider's message: it can echo the
    // recipient address and request metadata into our logs.
    if (error) throw new Error("Invitation email could not be sent.");
  }
}
