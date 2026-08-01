import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const API = join(process.cwd(), "src", "app", "api", "invitations");
const issue = readCode(join(API, "route.ts"));
const accept = readCode(join(API, "accept", "route.ts"));

/**
 * The two rules this feature exists to get right, asserted at the source.
 *
 * Both concern what the code must NOT do, and both have failure modes that are
 * invisible at runtime until they matter: a token in a log nobody reads, and an
 * orphaned auth user on no admin surface.
 */
describe("invitation issue", () => {
  it("stores only a hash and returns no token", () => {
    expect(issue).toContain("hashInvitationToken(token)");
    // The DTO is the thing most likely to grow a token field by accident.
    expect(issue).not.toMatch(/token:\s*token/);
    expect(issue).not.toMatch(/Response\.json\([^)]*\btoken\b/);
  });

  it("never logs the token", () => {
    expect(issue).not.toMatch(/console\.[a-z]+\([^)]*token/i);
  });

  it("rolls the row back when delivery fails", () => {
    // A stored invitation whose link was never sent is unrecoverable: the
    // plaintext cannot be recovered from the hash and there is no resend.
    expect(issue).toMatch(/catch[\s\S]{0,200}invitation\.delete/);
  });

  it("is admin-only", () => {
    expect(issue).toContain("requireAdmin()");
  });
});

describe("invitation acceptance", () => {
  it("creates the auth user before opening the transaction", () => {
    // A remote call cannot join a Prisma transaction. Ordering is the whole
    // difficulty of this route.
    expect(accept.indexOf("admin.auth.admin.createUser")).toBeLessThan(
      accept.indexOf("prisma.$transaction"),
    );
  });

  it("deletes the orphaned auth user when the transaction fails", () => {
    // Otherwise the account can sign in, is rejected by requireSession forever,
    // and appears on no admin surface — invisible and unfixable.
    expect(accept).toMatch(/catch[\s\S]{0,400}admin\.auth\.admin\.deleteUser/);
  });

  it("uses the auth UUID as the primary key", () => {
    expect(accept).toMatch(/id:\s*authUserId/);
  });

  it("refuses a body supplying the email or role", () => {
    // The invitation determines both. A body carrying them is an attempt to
    // self-assign a role, not a value to reason about.
    expect(accept).toContain(".strict()");
    expect(accept).toMatch(/email:\s*invitation\.email/);
    expect(accept).toMatch(/role:\s*invitation\.role/);
  });

  it("consumes the token only on success", () => {
    // The update is inside the transaction, and guarded on the row still being
    // unaccepted and unrevoked so a concurrent accept cannot double-spend it.
    expect(accept).toMatch(/acceptedAt:\s*null,\s*revokedAt:\s*null/);
  });

  it("carries displayName from the invitation to the user", () => {
    expect(accept).toMatch(/displayName:\s*invitation\.displayName/);
  });
});
