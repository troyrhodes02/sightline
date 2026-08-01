import "server-only";

import type { InvitationEmail, InvitationMailer } from "./types";
import { renderInvitationEmail } from "./invitation-email";

/**
 * Local development transport.
 *
 * Writes the acceptance URL to the **server** console. It never reaches a
 * response body, because a route that returned the token would defeat the point
 * of hashing it — and it would be an easy thing to leave in.
 */
export class ConsoleInvitationMailer implements InvitationMailer {
  async send(email: InvitationEmail): Promise<void> {
    const { subject } = renderInvitationEmail(email);
    console.warn(
      [
        "",
        "─── invitation email (console transport) ───",
        `to:      ${email.to}`,
        `role:    ${email.role}`,
        `subject: ${subject}`,
        `accept:  ${email.acceptUrl}`,
        "────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}
