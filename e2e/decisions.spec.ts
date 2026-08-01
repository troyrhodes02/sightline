import { test, expect, type Page } from "@playwright/test";

/**
 * Pitch 4 role enforcement, end to end: the decision and resolve routes are
 * rejected server-side for viewers, and viewer payloads carry no decision
 * keys. Follows the suite convention: when the environment is absent these
 * report as **skipped, never as passed**.
 *
 * The full take→fade browser flow needs seeded contracts in the e2e
 * database, which no seeding path provides yet; route-level enforcement and
 * payload shape are asserted here, and the flow is covered by jsdom
 * component tests plus the structural suite.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL;
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD;

const configured = Boolean(
  ADMIN_EMAIL && ADMIN_PASSWORD && VIEWER_EMAIL && VIEWER_PASSWORD,
);

test.skip(
  !configured,
  "Requires a provisioned Supabase project and seeded accounts. Set E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_VIEWER_EMAIL and E2E_VIEWER_PASSWORD.",
);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/slate");
}

test.describe("decision-log enforcement", () => {
  test("a viewer's decision and resolve writes are rejected server-side", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    const decision = await page.request.post("/api/decisions", {
      data: {
        contractId: "00000000-0000-0000-0000-000000000000",
        disposition: "took",
      },
    });
    expect(decision.status()).toBe(403);

    const resolve = await page.request.post(
      "/api/contracts/00000000-0000-0000-0000-000000000000/resolve",
      { data: { playerId: "00000000-0000-0000-0000-000000000000" } },
    );
    expect(resolve.status()).toBe(403);
  });

  test("a viewer's slate payload carries no decision keys at all", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);
    const response = await page.request.get("/api/slate");
    expect(response.ok()).toBeTruthy();
    const body = JSON.stringify(await response.json());
    // Absence, not null: the serializer never emits the keys.
    expect(body).not.toContain("currentDisposition");
    expect(body).not.toContain("decidedAt");
    expect(body).not.toContain("resolutionNote");
  });

  test("an admin decision on a nonexistent contract is not_found, and a snapshot-carrying body is rejected", async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    const missing = await page.request.post("/api/decisions", {
      data: {
        contractId: "00000000-0000-0000-0000-000000000000",
        disposition: "took",
      },
    });
    expect(missing.status()).toBe(404);

    const smuggled = await page.request.post("/api/decisions", {
      data: {
        contractId: "00000000-0000-0000-0000-000000000000",
        disposition: "took",
        snapshotEdgePoints: 99,
      },
    });
    expect(smuggled.status()).toBe(400);
  });
});
