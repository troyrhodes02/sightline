import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const priceRefreshCode = readCode(
  join(
    process.cwd(),
    "src",
    "app",
    "api",
    "pipeline",
    "price-refresh",
    "route.ts",
  ),
);
const keepaliveCode = readCode(
  join(process.cwd(), "src", "app", "api", "pipeline", "keepalive", "route.ts"),
);
const bothRoutes = [priceRefreshCode, keepaliveCode];

/**
 * The `/api/pipeline/*` namespace (RD-20): machine-authenticated, and the
 * token authorizes reporting and refresh only. These assertions pin the
 * auth mode, the honest error split (401 caller vs 503 misconfiguration),
 * and the boundaries the routes must not cross.
 */
describe("pipeline routes: scheduler auth", () => {
  it.each([["price-refresh"], ["keepalive"]])(
    "%s verifies the bearer token and never a user session",
    (name) => {
      const code = name === "price-refresh" ? priceRefreshCode : keepaliveCode;
      expect(code).toContain("verifyPipelineToken");
      expect(code).not.toContain("requireSession");
      expect(code).not.toContain("requireAdmin");
    },
  );

  it("answers 401 for bad credentials and 503 for an unset token", () => {
    for (const code of bothRoutes) {
      expect(code).toMatch(/"unauthorized"[\s\S]{0,200}unauthorized/);
      expect(code).toContain('"unconfigured"');
      expect(code).toContain("upstream_unavailable");
    }
  });

  it("accepts no user identifier anywhere", () => {
    for (const code of bothRoutes) {
      expect(code).not.toMatch(/userId/);
      expect(code).not.toMatch(/session/i);
    }
  });

  it("is never statically rendered", () => {
    for (const code of bothRoutes) {
      expect(code).toContain('dynamic = "force-dynamic"');
    }
  });
});

describe("price-refresh route: cadence and reuse", () => {
  it("decides cadence server-side from the stored schedule", () => {
    expect(priceRefreshCode).toContain("decidePriceRefreshAction");
    expect(priceRefreshCode).toMatch(/status: "scheduled"/);
  });

  it("reuses the existing market sync — no second Kalshi client", () => {
    expect(priceRefreshCode).toContain("runMarketSync()");
    expect(priceRefreshCode).not.toContain("listOpenMarkets");
    expect(priceRefreshCode).not.toContain("fetch(");
  });

  it("skips Kalshi entirely when not expected", () => {
    // The not_expected branch returns before any sync call.
    expect(priceRefreshCode).toMatch(
      /"not_expected"[\s\S]*?finalSnapshotsCaptured: 0/,
    );
  });

  it("runs the final-snapshot capture pass", () => {
    expect(priceRefreshCode).toContain("captureFinalPreKickoffSnapshots");
  });

  it("degraded Kalshi stays a 200 with the sync outcome, never a 5xx", () => {
    expect(priceRefreshCode).toContain("degraded: sync.degraded");
  });
});

describe("keepalive route: validation", () => {
  it("validates the report and rejects future actedAt", () => {
    expect(keepaliveCode).toContain("keepaliveInputSchema.safeParse");
    expect(keepaliveCode).toContain("actedAtIsPlausible");
    expect(keepaliveCode).toContain("validation_error");
  });
});
