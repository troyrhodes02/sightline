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
    "decision",
    "route.ts",
  ),
);

describe("access decision route", () => {
  it("is admin-only", () => {
    expect(code).toContain("requireAdmin()");
  });

  it("blocks deciding on your own account server-side", () => {
    // Also enforced by a check constraint. With one admin, self-denial locks
    // the operator out of their own product.
    expect(code).toMatch(/id === session\.user\.id/);
  });

  it("declares legal transitions as a table rather than a branch chain", () => {
    // So an illegal transition is rejected by construction rather than by
    // whichever `if` happened to be written first.
    expect(code).toContain("ALLOWED_FROM");
    expect(code).toMatch(/approve:\s*\["pending"\]/);
    expect(code).toMatch(/deny:\s*\["pending"\]/);
    expect(code).toMatch(/revoke:\s*\["active"\]/);
  });

  it("writes the decision before touching the auth provider", () => {
    expect(code.indexOf("prisma.user.update")).toBeLessThan(
      code.indexOf("auth.admin.signOut"),
    );
  });

  it("does not fail the request when token invalidation fails", () => {
    expect(code).toMatch(
      /try\s*\{[\s\S]{0,200}auth\.admin\.signOut[\s\S]{0,200}\}\s*catch/,
    );
  });

  it("does not invalidate tokens on approval", () => {
    // Approving someone should not sign them out of a session they do not have.
    expect(code).toMatch(/action !== "approve"[\s\S]{0,400}signOut/);
  });

  it("is never statically rendered", () => {
    expect(code).toContain('dynamic = "force-dynamic"');
  });
});
