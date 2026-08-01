import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * Sign-in must not become an account-existence oracle.
 *
 * On an invite-only product, distinguishing "no such account" from "wrong
 * password" tells an attacker who is in the group — which is itself the
 * private information the access model exists to protect.
 *
 * Asserted structurally because the property is about what the code CANNOT
 * say. A behavioural test needs a live Supabase project; the adversarial
 * timing-and-parity check against a real one lands in SIG-38.
 */
describe("sign-in route", () => {
  const code = readCode(
    join(process.cwd(), "src", "app", "api", "auth", "sign-in", "route.ts"),
  );

  it("uses exactly one message for every credential failure", () => {
    const matches = code.match(/CREDENTIALS_REJECTED/g) ?? [];
    // One definition plus each rejection path: bad shape, rate limit, bad
    // credentials, and revoked account.
    expect(matches.length).toBeGreaterThanOrEqual(5);

    // No alternative phrasing may exist alongside it.
    expect(code).not.toMatch(
      /no account|not found|unknown email|no such user/i,
    );
  });

  it("answers a revoked account exactly as a wrong password", () => {
    expect(code).toMatch(
      /status === "revoked"[\s\S]{0,200}unauthorized",\s*CREDENTIALS_REJECTED/,
    );
  });

  it("keeps a provider outage distinguishable", () => {
    // Someone who typed the right password must never be told they did not.
    expect(code).toContain("upstream_unavailable");
    expect(code).toContain("Sign-in is unavailable right now.");
  });

  it("rate-limits without confirming the address is worth limiting", () => {
    expect(code).toMatch(/rate_limited",\s*CREDENTIALS_REJECTED/);
  });

  it("refuses an absolute redirect target", () => {
    // An unvalidated `redirectTo` is an open redirect, and a sign-in page is
    // the most useful place in an application to have one. The schema pins the
    // value to a single-slash-prefixed path, so "//evil.example" is rejected.
    expect(code).toContain("redirectTo must be a relative path");
    expect(code).toContain('redirectTo ?? "/slate"');
  });

  it("is never statically rendered", () => {
    expect(code).toContain('dynamic = "force-dynamic"');
  });
});
