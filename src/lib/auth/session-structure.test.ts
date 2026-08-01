import { join } from "node:path";
import { productionFiles, readCode } from "@/lib/testing/source";

/**
 * The invariant this milestone rests on: **authorization is a database fact,
 * not a token claim.**
 *
 * A behavioural test cannot express "no module anywhere reads the role from a
 * JWT" — you cannot call the code nobody wrote. So this reads the source.
 */
describe("role resolution", () => {
  const SRC = join(process.cwd(), "src");
  const files = productionFiles(SRC);

  it("never derives a role from a token claim", () => {
    const offenders = files.filter((file) => {
      const code = readCode(file);
      return (
        /app_metadata/.test(code) ||
        /user_metadata/.test(code) ||
        /jwt.*\.role|claims?\.role/i.test(code)
      );
    });

    expect(offenders).toEqual([]);
  });

  it("resolves the role from the users table", () => {
    const code = readCode(join(SRC, "lib", "auth", "session.ts"));

    expect(code).toContain("prisma.user.findUnique");
    expect(code).toContain("hasAccess(user.status)");
    // A blocked account must be signed OUT rather than merely redirected, or
    // the stale cookie survives to the next request.
    expect(code).toContain("signOut");
    // The status travels on the URL so the sign-in page can say which of the
    // three it is — pending, denied, or revoked.
    expect(code).toContain("reason=${user.status}");
  });

  it("denies admin routes in place rather than redirecting", () => {
    const code = readCode(join(SRC, "lib", "auth", "session.ts"));

    expect(code).toContain("forbidden()");
    // A redirect would confirm the route exists and is worth redirecting from.
    expect(code).not.toMatch(/role !== "admin"[\s\S]{0,80}redirect\(/);
  });

  it("keeps the session resolver server-only", () => {
    const raw = readCode(join(SRC, "lib", "auth", "session.ts"));
    expect(raw).toContain("server-only");
  });
});
