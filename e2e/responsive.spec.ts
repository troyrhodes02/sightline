import { expect, test } from "@playwright/test";

/**
 * Responsive verification at the width the milestone's criteria are stated at.
 *
 * 320px, not "mobile". A device preset is 375–393px, and the difference is
 * exactly where a table stops fitting.
 *
 * Covers the routes reachable without a session. The authenticated ones are in
 * `authenticated.spec.ts`, which requires a provisioned environment.
 */

const NARROW = { width: 320, height: 720 };

const PUBLIC_ROUTES = [
  { path: "/sign-in", name: "sign in" },
  { path: "/sign-in?reason=revoked", name: "sign in — revoked" },
  { path: "/invite/not-a-real-token", name: "invitation — invalid" },
  { path: "/no-such-page", name: "not found" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode at 320px`, () => {
    test.use({ viewport: NARROW, colorScheme: scheme });

    for (const route of PUBLIC_ROUTES) {
      test(`${route.name} does not scroll horizontally`, async ({ page }) => {
        await page.goto(route.path);

        const overflows = await page.evaluate(() => {
          const doc = document.scrollingElement ?? document.documentElement;
          return doc.scrollWidth > doc.clientWidth;
        });

        expect(overflows).toBe(false);
      });
    }

    test("a long email does not force the sign-in page to scroll", async ({
      page,
    }) => {
      await page.goto("/sign-in");

      // 64 characters, per the milestone's stated criterion.
      const long = `${"a".repeat(52)}@example.com`;
      await page.getByLabel("Email").fill(long);

      const overflows = await page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        return doc.scrollWidth > doc.clientWidth;
      });

      expect(overflows).toBe(false);
    });
  });
}

test.describe("sign-in at 320px", () => {
  test.use({ viewport: NARROW });

  test("keeps every action reachable", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("offers no signup, recovery, or social auth", async ({ page }) => {
    await page.goto("/sign-in");
    const body = (await page.textContent("body")) ?? "";

    expect(body).not.toMatch(/sign up|create an account|register/i);
    expect(body).not.toMatch(/forgot|reset your password/i);
    expect(body).not.toMatch(/continue with|sign in with/i);
    expect(await page.locator("a").count()).toBe(0);
  });
});
