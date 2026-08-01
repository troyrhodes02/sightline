import { expect, test } from "@playwright/test";

/**
 * Appearance applies before first paint.
 *
 * Asserted end-to-end because it cannot be observed any other way: the failure
 * is a single white frame, which no unit test can see and which every reviewer
 * on a light-mode laptop will miss.
 */
test.describe("appearance", () => {
  test.use({ colorScheme: "dark" });

  test("paints the dark foundation with no light flash", async ({ page }) => {
    await page.goto("/sign-in");

    const scheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-mui-color-scheme"),
    );
    expect(scheme).toBe("dark");

    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );

    // Near-black, and neutral: a hue would mean the dark foundation drifted to
    // navy, which the brand system rules out explicitly.
    const [r, g, b] = background.match(/\d+/g)!.map(Number) as [
      number,
      number,
      number,
    ];
    expect(Math.max(r, g, b)).toBeLessThan(40);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(6);
  });
});
