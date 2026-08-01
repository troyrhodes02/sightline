import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * The proxy refreshes a cookie. It is not the authorization boundary, and this
 * test exists so it does not quietly become one.
 *
 * The danger is subtle: a role check here looks like defence in depth, but it
 * invites later code to assume the proxy ran — and it does not run on every
 * path, cannot read Postgres cheaply, and is bypassed by any route falling
 * outside the matcher.
 */
describe("proxy (session refresh)", () => {
  const src = join(process.cwd(), "src");
  const entryPath = join(src, "proxy.ts");
  const helperPath = join(src, "lib", "supabase", "session-refresh.ts");
  const modules = [readCode(entryPath), readCode(helperPath)];

  it("performs no role check", () => {
    for (const code of modules) {
      expect(code).not.toMatch(/\brole\b\s*===/);
      expect(code).not.toContain("requireAdmin");
      expect(code).not.toContain('"admin"');
    }
  });

  it("does not query the database", () => {
    for (const code of modules) {
      expect(code).not.toContain("prisma");
    }
  });

  it("does not redirect, so it gates nothing", () => {
    for (const code of modules) {
      expect(code).not.toContain("NextResponse.redirect");
    }
  });

  it("says in the file that it is not the boundary", () => {
    // Asserted against raw text on purpose: this one IS about the comment.
    expect(readFileSync(entryPath, "utf8")).toMatch(
      /[Nn]ot the authorization boundary/,
    );
  });
});
