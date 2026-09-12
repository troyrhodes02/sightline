import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * Paper Bot Lab routes (design doc §9), structural invariants a behavioural test
 * cannot express: both the Bots list and the bot detail reject a viewer
 * server-side before any shell renders (`requireAdmin()` precedes the first
 * read), and neither is statically rendered. A viewer deep-linking to
 * `/autonomy/bots` or `/autonomy/bots/[id]` is 403'd by the guard, not shown a
 * partial shell.
 */

const APP = join(process.cwd(), "src", "app", "(app)");
const listPage = readCode(join(APP, "autonomy", "bots", "page.tsx"));
const detailPage = readCode(join(APP, "autonomy", "bots", "[id]", "page.tsx"));

describe("Paper Bot Lab — admin-only, no shell first", () => {
  it("the list page and detail page require admin", () => {
    expect(listPage).toContain("requireAdmin()");
    expect(detailPage).toContain("requireAdmin()");
  });

  it("guards before any read on the list page", () => {
    const guardAt = listPage.indexOf("await requireAdmin()");
    const readAt = listPage.indexOf("readPaperBots(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(guardAt);
  });

  it("guards before any read on the detail page", () => {
    const guardAt = detailPage.indexOf("await requireAdmin()");
    const readAt = detailPage.indexOf("readBotDetail(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(guardAt);
  });

  it("are never statically rendered", () => {
    expect(listPage).toContain('dynamic = "force-dynamic"');
    expect(detailPage).toContain('dynamic = "force-dynamic"');
  });
});
