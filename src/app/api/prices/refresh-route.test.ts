import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const refreshCode = readCode(
  join(process.cwd(), "src", "app", "api", "prices", "refresh", "route.ts"),
);
const resolveCode = readCode(
  join(
    process.cwd(),
    "src",
    "app",
    "api",
    "contracts",
    "[id]",
    "resolve",
    "route.ts",
  ),
);

describe("price refresh route", () => {
  it("requires a session — shared surface, but never anonymous", () => {
    expect(refreshCode).toContain("requireSession()");
  });

  it("delegates rate-limit discipline to the server-side sync", () => {
    expect(refreshCode).toContain("runMarketSync()");
    // The route itself never touches the Kalshi client directly.
    expect(refreshCode).not.toContain("listOpenMarkets");
    expect(refreshCode).not.toContain("fetch(");
  });

  it("is never statically rendered", () => {
    expect(refreshCode).toContain('dynamic = "force-dynamic"');
  });
});

describe("contract resolve route", () => {
  it("is admin-only, enforced server-side", () => {
    expect(resolveCode).toContain("requireAdmin()");
  });

  it("accepts only a playerId — nothing else in the body is trusted", () => {
    expect(resolveCode).toMatch(
      /z\s*\.object\(\{ playerId: z\.uuid\(\) \}\)\s*\.strict\(\)/,
    );
  });

  it("writes the mapping as manual_override through PlayerExternalId", () => {
    expect(resolveCode).toContain("playerExternalId.upsert");
    expect(resolveCode).toContain('"manual_override"');
  });

  it("resolves and remaps in one transaction", () => {
    expect(resolveCode).toContain("$transaction");
  });

  it("rejects re-resolving an already resolved contract", () => {
    expect(resolveCode).toContain("invalid_state_transition");
  });

  it("records the acting admin from the session, never from the body", () => {
    expect(resolveCode).toContain("resolvedBy: session.user.id");
    expect(resolveCode).not.toMatch(/body[\s\S]{0,60}resolvedBy/);
  });

  it("is never statically rendered", () => {
    expect(resolveCode).toContain('dynamic = "force-dynamic"');
  });
});
