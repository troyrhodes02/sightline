import "server-only";

import { serverEnv } from "@/env";
import { ConsoleInvitationMailer } from "./console";
import { ResendInvitationMailer } from "./resend";
import type { InvitationMailer } from "./types";

export type { InvitationEmail, InvitationMailer } from "./types";

/**
 * Selects the transport from configuration.
 *
 * Falls back to the console transport only when no API key is configured, so a
 * misconfigured production deploy fails loudly at send time rather than
 * silently logging invitations into a log nobody reads.
 */
export function invitationMailer(): InvitationMailer {
  const env = serverEnv();

  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "RESEND_API_KEY is required in production; the console transport is a development aid.",
      );
    }
    return new ConsoleInvitationMailer();
  }

  return new ResendInvitationMailer(env.RESEND_API_KEY, env.MAIL_FROM);
}
