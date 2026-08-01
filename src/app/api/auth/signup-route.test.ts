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
    // let anyone enumerate who is in the group. Every non-validation exit goes
    // through one helper, so there is a single response shape by construction.
    const exits = signUp.match(/return settle\(\)/g) ?? [];
    expect(exits.length).toBeGreaterThanOrEqual(4);
    expect(signUp).not.toMatch(/already (registered|exists|has an account)/i);
  });

  it("holds every path to the same response floor", () => {
    // A uniform BODY is not enough: the registered path returns after a local
    // read while a new address waits on a remote Supabase call, and that gap is
    // measurable from anywhere. The floor is what makes the timing uninformative.
    expect(signUp).toContain("RESPONSE_FLOOR_MS");
    expect(signUp).toMatch(/RESPONSE_FLOOR_MS - \(Date\.now\(\) - startedAt\)/);
  });

  it("bounds how many requests can be outstanding", () => {
    // The per-address limit stops one person retrying; it does nothing about a
    // script cycling through addresses, each creating an auth user and a row.
    expect(signUp).toContain("MAX_PENDING_REQUESTS");
    expect(signUp).toMatch(
      /prisma\.user\.count\([\s\S]{0,80}status:\s*"pending"/,
    );
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
