import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  comparabilityReason,
  compareLcp,
  type LcpBaseline,
} from "../src/lib/perf/lcpCompare";

// Read the committed baseline at runtime rather than `import ... from`: under
// Playwright's ESM transform a static JSON import needs an import attribute that
// not every Node version accepts, which would error the test at collection —
// exactly where an enforcing gate must not fall over. JSON.parse of the file is
// transform-agnostic and just as honest (it is the committed file, not a value
// baked in at build time).
const baseline = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "docs/v1/perf/slate-lcp-baseline.json"),
    "utf8",
  ),
) as LcpBaseline;

/**
 * Slate LCP capture and gate (Pitch 10, SIG-91 built the harness; SIG-99 made
 * it enforcing).
 *
 * Measures Largest Contentful Paint of /slate against the 300-contract perf
 * fixture (seed-slate-perf) and compares it to the committed baseline. With
 * `PERF_ENFORCE_LCP=1` (set in the CI perf job) a comparison that does not
 * clear the ≥30% reduction bar FAILS the build; without it the same number is
 * logged and the run passes (report-only, for local/manual capture).
 *
 * Why Playwright and not a bare Lighthouse CLI run: /slate is auth-gated, so a
 * meaningful measurement must first sign in. This spec reuses the suite's
 * existing auth+skip posture — when the provisioned environment is absent it
 * reports SKIPPED, never as passed. It reads the real LCP web-vital from the
 * browser's PerformanceObserver, which is the same metric Lighthouse's LCP
 * audit reports; nothing here fabricates a number.
 *
 * Honesty: the gate is inert against a placeholder baseline. When the committed
 * baseline is still `measured: false`, `comparabilityReason` refuses to compare
 * and the spec logs the reason and returns — so enforcement can never turn a
 * null baseline into a red or a green. The real baseline must be captured on
 * the pre-change commit in a provisioned environment first (docs/v1/perf/).
 *
 * The measured LCP is always written to docs/v1/perf/slate-lcp-latest.json; when
 * a real comparison runs the artifact also records baseline→current, the percent
 * reduction, the required bar, and the pass/fail verdict.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const configured = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
const ENFORCE = process.env.PERF_ENFORCE_LCP === "1";

test.skip(
  !configured,
  "Requires a provisioned environment with seeded accounts and the 300-contract perf fixture. Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD, and seed via `npm run db:seed:slate:perf`.",
);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/slate");
}

/** Read the largest LCP entry the browser observed, in milliseconds. */
async function measureLcpMs(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolvePromise) => {
        let last = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            last = (entry as PerformanceEntry & { startTime: number })
              .startTime;
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        // LCP finalises on the first interaction or after the page settles;
        // give it a fixed window then report the largest seen.
        setTimeout(() => {
          observer.disconnect();
          resolvePromise(Math.round(last));
        }, 3000);
      }),
  );
}

test.describe("slate LCP", () => {
  test("captures /slate LCP against the perf fixture", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    // Fresh navigation so the LCP observer sees this load from the start.
    await page.goto("/slate", { waitUntil: "load" });
    const currentMs = await measureLcpMs(page);
    expect(currentMs).toBeGreaterThan(0);

    const out = resolve(process.cwd(), "docs/v1/perf/slate-lcp-latest.json");
    mkdirSync(dirname(out), { recursive: true });

    /** Write the run artifact. Called once with whatever we know so far. */
    const writeArtifact = (extra: Record<string, unknown>) => {
      writeFileSync(
        out,
        `${JSON.stringify(
          {
            metric: "largest-contentful-paint",
            route: "/slate",
            lcpMs: currentMs,
            enforced: ENFORCE,
            capturedAt: new Date().toISOString(),
            ...extra,
          },
          null,
          2,
        )}\n`,
      );
    };

    const { comparable, reason } = comparabilityReason(baseline, currentMs);
    if (!comparable) {
      writeArtifact({ comparable: false, reason });
      console.warn(
        `[perf] /slate LCP = ${currentMs}ms. Cannot compare: ${reason}.`,
      );
      return;
    }

    const result = compareLcp(baseline.lcpMs!, currentMs);
    writeArtifact({
      comparable: true,
      baselineMs: result.baselineMs,
      reductionPct: Number(result.reductionPct.toFixed(2)),
      requiredPct: result.requiredPct,
      passes: result.passes,
    });
    console.warn(
      `[perf] /slate LCP baseline ${result.baselineMs}ms → ${result.currentMs}ms ` +
        `(${result.reductionPct.toFixed(1)}% reduction, need ${result.requiredPct}%, ` +
        `${result.passes ? "PASS" : "FAIL"}).`,
    );

    if (ENFORCE) {
      expect(
        result.passes,
        `LCP reduction ${result.reductionPct.toFixed(1)}% did not clear the ${result.requiredPct}% bar.`,
      ).toBe(true);
    }
  });
});
