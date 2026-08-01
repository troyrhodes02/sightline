import { expect, test } from "@playwright/test";

/**
 * The font actually loads and actually renders.
 *
 * This suite exists because a broken `var()` expression shipped once and no
 * unit test could see it: `next/font` is stubbed under Jest, so the family
 * string is never resolved against a real stylesheet. Only a browser can tell
 * you that `font-family` was discarded as invalid and the page quietly fell
 * back to `system-ui`.
 */
test.describe("typography", () => {
  test("resolves to Space Grotesk rather than a fallback", async ({ page }) => {
    await page.goto("/sign-in");

    const family = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );

    // The custom property must have resolved to a real family name. If the
    // var() was invalid, this reads "system-ui" or similar.
    expect(family.toLowerCase()).toContain("space");
    expect(family).not.toMatch(/^system-ui/);
    expect(family).not.toContain("var(");
  });

  test("serves the font file", async ({ page }) => {
    const fontRequests: string[] = [];
    page.on("response", (response) => {
      if (/\.woff2?(\?|$)/.test(response.url())) {
        fontRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto("/sign-in");
    await page.evaluate(() => document.fonts.ready);

    expect(fontRequests.length).toBeGreaterThan(0);
    for (const request of fontRequests) {
      expect(request).toMatch(/^200 /);
    }
  });

  test("renders numerics with tabular figures", async ({ page }) => {
    // Space Grotesk's default figures are proportional, so without tabular-nums
    // every numeric column in the product drifts. Measured rather than trusted.
    await page.goto("/sign-in");

    const equalWidths = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.fontVariantNumeric = "tabular-nums";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);

      const widths = new Set<number>();
      for (const digit of "0123456789") {
        probe.textContent = digit;
        widths.add(Math.round(probe.getBoundingClientRect().width * 100));
      }
      probe.remove();
      return widths.size === 1;
    });

    expect(equalWidths).toBe(true);
  });
});
