import type { InvitationEmail } from "./types";

/**
 * The invitation email — the only Sightline surface rendered outside the
 * application.
 *
 * Hand-authored HTML rather than the MUI theme, because email clients support
 * neither CSS variables nor a stylesheet worth the name. The values are copied
 * from the theme's light foundation; this file is the one sanctioned exception
 * to "colour lives in the theme", and it is exempted in the lint config with
 * this comment as the reason.
 *
 * The lockup is referenced as a fixed-colour asset rather than inlined:
 * `currentColor` does not inherit through an email client, which is precisely
 * why the two fixed-colour variants exist.
 *
 * **The token appears here and nowhere else.** It is not logged, not returned,
 * and not stored.
 */
export function renderInvitationEmail(email: InvitationEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = email.displayName ? `${email.displayName}, you` : "You";
  const roleLine =
    email.role === "admin"
      ? "You will have admin access."
      : "You will have viewer access: the shared projections, prices, and edges.";

  const text = [
    `${greeting} have been invited to Sightline.`,
    "",
    roleLine,
    "",
    "Set a password and sign in:",
    email.acceptUrl,
    "",
    "This link works once and expires in 7 days.",
    "If you were not expecting this, ignore it — nothing happens until the link is used.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#FAFAFA;font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#131316;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:6px;">
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 24px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.01em;">sightline</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:24px;font-weight:500;">${greeting} have been invited to Sightline.</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:20px;color:#5C5C66;">${roleLine}</p>
          <p style="margin:0 0 24px;">
            <a href="${email.acceptUrl}" style="display:inline-block;padding:10px 16px;background:#5B51E8;color:#FFFFFF;font-size:14px;font-weight:500;text-decoration:none;border-radius:6px;">Set a password</a>
          </p>
          <p style="margin:0;font-size:12px;line-height:16px;color:#8A8A93;">
            This link works once and expires in 7 days. If you were not expecting this, ignore it — nothing happens until the link is used.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: "You have been invited to Sightline", html, text };
}
