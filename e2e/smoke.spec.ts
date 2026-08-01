import { expect, test } from "@playwright/test";

/**
 * Foundation smoke test.
 *
 * Proves the harness runs against a real build, and that the unauthenticated
 * entry path behaves: the root has no content of its own, and an anonymous
 * caller ends up at sign-in rather than at anything else.
 */
test.describe("application foundation", () => {
  test("sends an anonymous caller from the root to sign in", async ({
    page,
  }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    // `/` redirects to `/slate`, whose layout resolves the session and bounces
    // an anonymous caller. One decision, in one place.
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page).toHaveTitle("Sign in · Sightline");
  });

  test("does not leak server configuration to the client", async ({ page }) => {
    await page.goto("/sign-in");
    const html = await page.content();

    // The service-role key and both connection strings are server-side only.
    // Asserting the delivered document is the cheapest place to catch a
    // regression that would otherwise ship silently.
    expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(html).not.toContain("postgresql://");
    expect(html).not.toContain("DIRECT_URL");
  });
});
