import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * Model Performance routes + rename (PME-4, D9/D12), structural invariants a
 * behavioural test cannot express: every level of the surface and the overrides
 * subroute reject a viewer server-side before any shell renders; the retired
 * `/accuracy` and `/accuracy/overrides` 308-redirect (carrying `level=advanced`
 * for a statistical deep link); and no read on this surface writes production
 * config.
 */

const APP = join(process.cwd(), "src", "app", "(app)");
const modelPerformancePage = readCode(
  join(APP, "model-performance", "page.tsx"),
);
const overridesPage = readCode(
  join(APP, "model-performance", "overrides", "page.tsx"),
);
const accuracyRedirect = readCode(join(APP, "accuracy", "page.tsx"));
const overridesRedirect = readCode(
  join(APP, "accuracy", "overrides", "page.tsx"),
);
const readModule = readCode(
  join(process.cwd(), "src", "lib", "model-performance", "read.ts"),
);

describe("Model Performance — admin-only, no shell first (D9)", () => {
  it("the surface page and overrides page require admin", () => {
    expect(modelPerformancePage).toContain("requireAdmin()");
    expect(overridesPage).toContain("requireAdmin()");
  });

  it("guards before any read (requireAdmin precedes the first read call)", () => {
    // The guard must run before any data is fetched — a viewer must never reach
    // a partial shell. requireAdmin() appears before readModelPerformance /
    // readAccuracy in source order.
    const guardAt = modelPerformancePage.indexOf("await requireAdmin()");
    // The call site, not the import — `readModelPerformance()` with its args.
    const readAt = modelPerformancePage.indexOf("readModelPerformance()");
    expect(guardAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(guardAt);
  });

  it("are never statically rendered", () => {
    expect(modelPerformancePage).toContain('dynamic = "force-dynamic"');
    expect(overridesPage).toContain('dynamic = "force-dynamic"');
  });
});

describe("Accuracy → Model Performance redirects (D9)", () => {
  it("`/accuracy` 308-redirects to /model-performance", () => {
    expect(accuracyRedirect).toContain("permanentRedirect");
    expect(accuracyRedirect).toContain("/model-performance");
  });

  it("`/accuracy` carries level=advanced for a statistical deep link", () => {
    // The redirect sets level=advanced when a statistical scope key is present.
    expect(accuracyRedirect).toMatch(/level.*advanced|advanced.*level/s);
    expect(accuracyRedirect).toMatch(/record|version|population|stat|season/);
  });

  it("`/accuracy/overrides` 308-redirects to /model-performance/overrides", () => {
    expect(overridesRedirect).toContain("permanentRedirect");
    expect(overridesRedirect).toContain("/model-performance/overrides");
  });

  it("the redirect pages are not guarded surfaces (they never render)", () => {
    // A 308 redirect must not sit behind requireAdmin — that would 403 a viewer
    // instead of forwarding the deep link. The guard lives on the target route.
    expect(accuracyRedirect).not.toContain("requireAdmin");
    expect(overridesRedirect).not.toContain("requireAdmin");
  });
});

describe("Model Performance read — decision support, never a config write (D12)", () => {
  it("never writes ModelSelection or any config", () => {
    // The read composes evidence + scorecards; it must never mutate. No create,
    // update, upsert, or delete of any model-selection / config table.
    expect(readModule).not.toMatch(
      /\.create\(|\.update\(|\.upsert\(|\.delete\(/,
    );
    expect(readModule).not.toMatch(/modelSelection/i);
  });

  it("never reads a Kalshi price into the comparison", () => {
    // Prices never feed a projection or its comparison. The scorecard read marks
    // positions to market elsewhere; this assembly module reads no price cents.
    expect(readModule).not.toMatch(/askCents|bidCents|PriceObservation/);
  });
});
