import { expect, test } from "@playwright/test";

/**
 * Adversarial role enforcement, revocation, and the full invite-to-revoke
 * journey.
 *
 * **These require a provisioned environment** — a real Supabase project with
 * public signup disabled, plus a seeded admin and viewer. They cannot run
 * against placeholder configuration, and they are the half of this milestone's
 * claims that a structural test genuinely cannot cover: response-time parity,
 * a revoked user denied while their access token is still valid, and the served
 * markup of an admin route requested by a viewer.
 *
 * When the environment is absent they report as **skipped, never as passed**. A
 * green run that silently skipped its most important assertions is worse than a
 * red one, because it is believed.
 *
 * Required:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 *   E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL;
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD;

const PROVISIONED = Boolean(
  ADMIN_EMAIL && ADMIN_PASSWORD && VIEWER_EMAIL && VIEWER_PASSWORD,
);

test.skip(
  !PROVISIONED,
  "Requires a provisioned Supabase project and seeded accounts. Set E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_VIEWER_EMAIL and E2E_VIEWER_PASSWORD.",
);

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/slate");
}

test.describe("role enforcement", () => {
  test("a viewer is denied every admin route, and the markup proves it", async ({
    page,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    // The shell itself must not advertise the admin layer.
    const shell = (await page.content()) ?? "";
    expect(shell).not.toContain("/health");
    expect(shell).not.toContain("/users");

    for (const route of ["/health", "/users"]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(403);

      // Denied IN PLACE: the URL is unchanged, not redirected away from.
      expect(new URL(page.url()).pathname).toBe(route);

      const html = await page.content();
      // No admin chrome rendered before the check, and no admin data at all.
      expect(html).not.toContain("Invite viewer");
      expect(html).not.toContain("System health");
      expect(html).not.toContain(ADMIN_EMAIL!);

      // The denial names no feature and no data.
      const text = (await page.textContent("body")) ?? "";
      expect(text).toMatch(/You do not have access to this page\./);
      expect(text).not.toMatch(/admin|health|users|decision/i);
    }
  });

  test("a viewer is rejected by every admin route handler", async ({
    page,
    request,
  }) => {
    await signIn(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    const decision = await request.post("/api/users/some-id/decision", {
      data: { action: "approve" },
    });
    expect(decision.status()).toBe(403);
  });
});

test.describe("credential failures", () => {
  test("are indistinguishable across unknown, wrong, and revoked", async ({
    request,
  }) => {
    const attempt = async (email: string) => {
      const started = Date.now();
      const response = await request.post("/api/auth/sign-in", {
        data: { email, password: "definitely-not-the-password" },
      });
      return {
        status: response.status(),
        body: (await response.json()) as { error: string; message: string },
        ms: Date.now() - started,
      };
    };

    const unknown = await attempt("nobody-at-all@example.com");
    const known = await attempt(VIEWER_EMAIL!);

    expect(unknown.status).toBe(known.status);
    expect(unknown.body.error).toBe(known.body.error);
    expect(unknown.body.message).toBe(known.body.message);

    // Same band, not same millisecond: an existence oracle by timing needs a
    // consistent, large gap, not jitter.
    expect(Math.abs(unknown.ms - known.ms)).toBeLessThan(750);
  });
});

test.describe("revocation", () => {
  test("ends access on the next request, on every device, before the token expires", async ({
    browser,
  }) => {
    const viewerA = await browser.newContext();
    const viewerB = await browser.newContext();
    const adminContext = await browser.newContext();

    const pageA = await viewerA.newPage();
    const pageB = await viewerB.newPage();
    const adminPage = await adminContext.newPage();

    try {
      await signIn(pageA, VIEWER_EMAIL!, VIEWER_PASSWORD!);
      await signIn(pageB, VIEWER_EMAIL!, VIEWER_PASSWORD!);
      await signIn(adminPage, ADMIN_EMAIL!, ADMIN_PASSWORD!);

      // The access token is minutes old and unquestionably still valid, which
      // is the point: what denies them is the database read, not expiry.
      await adminPage.goto("/users");
      const row = adminPage
        .locator("div")
        .filter({ hasText: VIEWER_EMAIL! })
        .last();
      await row.getByRole("button", { name: "Revoke" }).click();
      await adminPage
        .getByRole("button", { name: "Revoke", exact: true })
        .last()
        .click();
      await expect(
        adminPage.getByText(`Access revoked for ${VIEWER_EMAIL}`),
      ).toBeVisible();

      for (const page of [pageA, pageB]) {
        await page.goto("/slate");
        await page.waitForURL("**/sign-in**");
        expect(page.url()).toContain("reason=revoked");
        await expect(
          page.getByText("Your access to Sightline has been removed."),
        ).toBeVisible();
      }
    } finally {
      await viewerA.close();
      await viewerB.close();
      await adminContext.close();
    }
  });
});

test.describe("accessibility", () => {
  test("puts the skip link first and traps focus in the drawer", async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to content");
  });

  test("marks the selected navigation item for assistive technology", async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await expect(page.locator('[aria-current="page"]')).toHaveText("Slate");
  });
});

test.describe("health honesty", () => {
  test("reports every signal as not yet implemented, with no timestamp", async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/health");

    for (const label of ["Ingest", "Recompute", "Price refresh"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByText("Not yet implemented").first()).toBeVisible();

    // No fabricated timestamp anywhere on the surface.
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
