import { expect, test } from "@playwright/test";

/**
 * Foundation smoke test.
 *
 * Deliberately thin: SIG-30 ships no screen worth asserting on. Its job is to
 * prove the Playwright harness runs against a real build in CI, so the suites
 * that matter — adversarial role enforcement and the 320px responsive checks in
 * SIG-38 — land into working infrastructure rather than debugging it.
 */
test.describe("application foundation", () => {
  test("serves the root layout", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Sightline");
  });

  test("does not leak server configuration to the client", async ({ page }) => {
    await page.goto("/");
    const html = await page.content();

    // The service-role key and both connection strings are server-side only.
    // Asserting on the delivered document is the cheapest place to catch a
    // regression that would otherwise ship silently.
    expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(html).not.toContain("postgresql://");
    expect(html).not.toContain("DIRECT_URL");
  });
});
