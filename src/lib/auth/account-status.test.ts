import { hasAccess, isSignInReason, STATUS_MESSAGE } from "./account-status";

describe("account status", () => {
  it("grants access only to an approved account", () => {
    expect(hasAccess("active")).toBe(true);
    for (const status of ["pending", "denied", "revoked"] as const) {
      expect(hasAccess(status)).toBe(false);
    }
  });

  it("has a distinct message for each non-active status", () => {
    const messages = Object.values(STATUS_MESSAGE);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("never explains WHY a decision was made", () => {
    // The product has no opinion to offer, and a reason invites an argument.
    for (const message of Object.values(STATUS_MESSAGE)) {
      expect(message).not.toMatch(/because|reason|admin decided|sorry/i);
    }
  });

  it("recognises only the three status reasons", () => {
    expect(isSignInReason("pending")).toBe(true);
    expect(isSignInReason("denied")).toBe(true);
    expect(isSignInReason("revoked")).toBe(true);
    expect(isSignInReason("active")).toBe(false);
    expect(isSignInReason(undefined)).toBe(false);
    expect(isSignInReason("../../etc/passwd")).toBe(false);
  });
});
