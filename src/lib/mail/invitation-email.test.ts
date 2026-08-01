import { renderInvitationEmail } from "./invitation-email";

const BASE = {
  to: "marcus@example.com",
  acceptUrl: "https://sightline.example/invite/TOKEN-abc123",
  role: "viewer" as const,
  displayName: null,
};

describe("invitation email", () => {
  it("carries the acceptance link in both parts", () => {
    const { html, text } = renderInvitationEmail(BASE);
    expect(html).toContain(BASE.acceptUrl);
    expect(text).toContain(BASE.acceptUrl);
  });

  it("greets by name when one was supplied", () => {
    const { text } = renderInvitationEmail({ ...BASE, displayName: "Dana" });
    expect(text).toContain("Dana, you have been invited");
  });

  it("describes viewer access without overstating it", () => {
    const { text } = renderInvitationEmail(BASE);
    expect(text).toContain("viewer access");
    // Viewers do not trade through Sightline, and the invitation must not imply
    // they might.
    expect(text.toLowerCase()).not.toContain("trade");
    expect(text.toLowerCase()).not.toContain("kalshi");
  });

  it("says the link is single-use and time-limited", () => {
    const { text } = renderInvitationEmail(BASE);
    expect(text).toContain("works once");
    expect(text).toContain("7 days");
  });

  it("asks for no credential and offers no signup", () => {
    const { html } = renderInvitationEmail(BASE);
    expect(html).not.toMatch(/<input|<form/i);
    expect(html.toLowerCase()).not.toContain("sign up");
  });
});
