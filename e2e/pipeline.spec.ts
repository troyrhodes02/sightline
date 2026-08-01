import { expect, test, type Page } from "@playwright/test";

/**
 * Live Pipeline & Staleness, end to end: the currency fields ride the shared
 * slate payload, the admin health surface renders the three pipeline signals,
 * the viewer shell carries no trace of it, and the scheduler routes admit no
 * caller without the bearer token.
 *
 * Follows the suite convention: authenticated assertions require a
 * provisioned Supabase project and seeded accounts, and report as **skipped,
 * never as passed** without one. Seeding stale/past-boundary contracts and
 * pipeline-run rows has no e2e seeding path (the decisions suite records the
 * same limitation), so chip rendering across all staleness states is covered
 * by the jsdom component suites; the payload shape and role boundaries are
 * asserted here.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL;
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD;

const PROVISIONED = Boolean(
  ADMIN_EMAIL && ADMIN_PASSWORD && VIEWER_EMAIL && VIEWER_PASSWORD,
);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/slate");
}

test.describe("scheduler route authentication", () => {
  // These need no seeded accounts: the routes are machine-facing and the
  // assertion is that no unauthenticated caller ever gets a 2xx.
  test("the pipeline routes reject callers without the scheduler token", async ({
    request,
  }) => {
    for (const path of [
      "/api/pipeline/price-refresh",
      "/api/pipeline/keepalive",
    ]) {
      const response = await request.post(path);
      // 401 when a token is configured but absent/mismatched; 503 when the
      // deployment has no token at all. Both are honest refusals; a 2xx here
      // would mean the scheduler surface is open.
      expect([401, 503]).toContain(response.status());
    }
  });

  test("a signed-in session grants nothing on the scheduler routes", async ({
    page,
  }) => {
    test.skip(!PROVISIONED, "Requires seeded accounts.");
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    const response = await page.request.post("/api/pipeline/price-refresh");
    expect([401, 503]).toContain(response.status());
  });
});

test.describe("currency on the shared slate", () => {
  test.skip(!PROVISIONED, "Requires seeded accounts.");

  test("the slate payload carries staleness and age fields for every row", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);
    const response = await page.request.get("/api/slate");
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      rows?: Array<Record<string, unknown>>;
    };
    for (const row of body.rows ?? []) {
      // The keys exist on every row; null means "no projection", a distinct
      // state from current (never an omitted key).
      expect(row).toHaveProperty("staleness");
      expect(row).toHaveProperty("projectionAge");
      expect(row).toHaveProperty("priceAge");
    }
    // Operational health never rides the shared payload.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("lastSuccess");
    expect(raw).not.toContain("pipeline_run");
    expect(raw).not.toContain("invocationId");
  });
});

test.describe("pipeline health surface", () => {
  test.skip(!PROVISIONED, "Requires seeded accounts.");

  test("the admin sees the three pipeline signals, honestly labelled", async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/health");

    // The three signal blocks, in their fixed order.
    const text = (await page.textContent("body")) ?? "";
    const ingest = text.indexOf("Ingest");
    const recompute = text.indexOf("Projection recomputation");
    const prices = text.indexOf("Price refresh");
    expect(ingest).toBeGreaterThanOrEqual(0);
    expect(recompute).toBeGreaterThan(ingest);
    expect(prices).toBeGreaterThan(recompute);

    // The retired pre-pipeline placeholder state never renders again, and
    // the surface reports without operating: no retry or run-now controls.
    expect(text).not.toContain("not yet implemented");
    await expect(
      page.getByRole("button", { name: /retry|run now/i }),
    ).toHaveCount(0);

    // No secret material on the operator surface.
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(text).not.toContain("Bearer ");
  });

  test("a viewer has no health navigation and is rejected on deep link", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    // Absence, not a disabled item: the shell never names the route.
    const shell = (await page.content()) ?? "";
    expect(shell).not.toContain("/health");

    const response = await page.goto("/health");
    expect(response?.status()).toBe(403);
    expect(new URL(page.url()).pathname).toBe("/health");
    const text = (await page.textContent("body")) ?? "";
    expect(text).not.toMatch(/ingest|recomputation|price refresh|keepalive/i);
  });
});
