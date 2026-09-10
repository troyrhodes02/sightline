import { test, expect, type Page } from "@playwright/test";

/**
 * Adjustment Suggestions role enforcement, end to end (SIG-80): the accept and
 * decline routes and the whole /suggestions section are rejected server-side for
 * viewers, and the admin can reach them. Follows the suite convention: when the
 * environment is absent these report as **skipped, never as passed**.
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

const NIL = "00000000-0000-0000-0000-000000000000";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/slate");
}

test.describe("suggestions enforcement", () => {
  test("a viewer's accept and decline writes are rejected server-side", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    const accept = await page.request.post(`/api/suggestions/${NIL}/accept`);
    expect(accept.status()).toBe(403);

    const decline = await page.request.post(`/api/suggestions/${NIL}/decline`);
    expect(decline.status()).toBe(403);
  });

  test("a viewer cannot see the Suggestions section or its nav entry", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);
    // Absence, not a disabled item: the nav must not name it.
    await expect(page.getByRole("link", { name: "Suggestions" })).toHaveCount(
      0,
    );
    // Deep-linking is rejected in place (403), never a partial admin shell.
    const res = await page.request.get("/suggestions");
    expect(res.status()).toBe(403);
  });

  test("the admin reaches the Suggestions section; accept of a missing id is 404, not 403", async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/suggestions");
    await expect(
      page.getByRole("heading", { name: "Suggestions" }),
    ).toBeVisible();

    // Admin is authorized; a nonexistent suggestion is a 404 (not a 403).
    const accept = await page.request.post(`/api/suggestions/${NIL}/accept`);
    expect(accept.status()).toBe(404);
  });
});
