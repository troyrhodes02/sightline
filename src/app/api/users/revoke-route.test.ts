import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const code = readCode(
  join(
    process.cwd(),
    "src",
    "app",
    "api",
    "users",
    "[id]",
    "revoke",
    "route.ts",
  ),
);

describe("revoke route", () => {
  it("is admin-only", () => {
    expect(code).toContain("requireAdmin()");
  });

  it("blocks self-revocation server-side", () => {
    // The control is absent from that row in the UI, but the block that
    // matters is here — a crafted request must be rejected too. With one
    // admin, self-revocation locks the operator out of their own product.
    expect(code).toMatch(/id === session\.user\.id/);
    expect(code).toContain("You cannot revoke your own access.");
  });

  it("writes the revocation before touching the auth provider", () => {
    // The database is the authoritative gate; the token invalidation is a
    // courtesy that shortens the window.
    expect(code.indexOf("prisma.user.update")).toBeLessThan(
      code.indexOf("auth.admin.signOut"),
    );
  });

  it("does not fail the request when token invalidation fails", () => {
    // requireSession denies the user on their next request regardless.
    // Rolling back because a cleanup failed would leave an admin believing
    // access ended when it had not — much the worse outcome.
    expect(code).toMatch(
      /try\s*\{[\s\S]{0,200}auth\.admin\.signOut[\s\S]{0,200}\}\s*catch/,
    );
    expect(code).not.toMatch(/catch[\s\S]{0,300}status:\s*"active"/);
  });

  it("resolves either a user or a pending invitation", () => {
    // The Users list is a union, so from the admin's side revoking a pending
    // invitation and revoking an account are one action.
    expect(code).toContain("prisma.user.findUnique");
    expect(code).toContain("prisma.invitation.findUnique");
  });

  it("is never statically rendered", () => {
    expect(code).toContain('dynamic = "force-dynamic"');
  });
});
