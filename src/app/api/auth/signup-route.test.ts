import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const signUp = readCode(
  join(process.cwd(), "src", "app", "api", "auth", "sign-up", "route.ts"),
);
const signIn = readCode(
  join(process.cwd(), "src", "app", "api", "auth", "sign-in", "route.ts"),
);

describe("sign-up route", () => {
  it("creates a pending account and grants nothing", () => {
    expect(signUp).toMatch(/status:\s*"pending"/);
    expect(signUp).toMatch(/role:\s*"viewer"/);
    // No session is established here — approval is the gate, not sign-up.
    expect(signUp).not.toContain("signInWithPassword");
  });

  it("never lets the caller choose a role", () => {
    // A body carrying `role` is an attempt to self-assign admin.
    expect(signUp).toContain(".strict()");
    expect(signUp).not.toMatch(/role:\s*parsed\.data|role:\s*body/);
  });

  it("answers identically whether or not the address is already registered", () => {
    // Sign-up is a public surface. A distinct "already registered" reply would
    // let anyone enumerate who is in the group.
    const uses = signUp.match(/SUBMITTED/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
    expect(signUp).not.toMatch(/already (registered|exists|has an account)/i);
  });

  it("deletes the orphaned auth user when the row write fails", () => {
    // Otherwise the account can authenticate, is rejected forever, and appears
    // on no admin surface — invisible and unfixable.
    expect(signUp).toMatch(/catch[\s\S]{0,300}deleteUser/);
  });

  it("rate-limits without revealing that it did", () => {
    expect(signUp).toMatch(/rateLimit\([\s\S]{0,80}\)\.allowed/);
  });
});

describe("sign-in route", () => {
  it("stays opaque when authentication fails", () => {
    const uses = signIn.match(/CREDENTIALS_REJECTED/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(5);
    expect(signIn).not.toMatch(/no account|unknown email|not registered/i);
  });

  it("reports status only AFTER authentication succeeds", () => {
    // Ordering is the safeguard: a guesser never reaches the status branch,
    // because a wrong password returns the opaque message first.
    expect(signIn.indexOf("signInWithPassword")).toBeLessThan(
      signIn.indexOf("hasAccess(user.status)"),
    );
    expect(signIn).toContain("STATUS_MESSAGE[user.status]");
  });

  it("tears the session down before reporting a blocked status", () => {
    expect(signIn).toMatch(
      /hasAccess\(user\.status\)[\s\S]{0,400}signOut\(\)[\s\S]{0,200}STATUS_MESSAGE/,
    );
  });
});
