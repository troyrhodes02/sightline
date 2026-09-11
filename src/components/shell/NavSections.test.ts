import {
  SECTIONS,
  adminSections,
  primaryTabs,
  visibleSections,
} from "./NavSections";

describe("navigation sections", () => {
  it("gives a viewer only the shared surfaces", () => {
    const labels = visibleSections("viewer").map((s) => s.label);
    expect(labels).toEqual(["Slate", "Prop Research", "Settings"]);
  });

  it("gives an admin every surface", () => {
    const labels = visibleSections("admin").map((s) => s.label);
    expect(labels).toEqual([
      "Slate",
      "Prop Research",
      "Model Performance",
      "Paper Bot",
      "Health",
      "Users",
      "Settings",
    ]);
  });

  // Absence, not a disabled item. A viewer must not be able to infer from the
  // interface that the private layer exists at all.
  it("omits admin surfaces from a viewer entirely rather than marking them", () => {
    const viewer = visibleSections("viewer");
    expect(viewer.some((s) => s.adminOnly)).toBe(false);
    expect(JSON.stringify(viewer)).not.toMatch(
      /health|users|accuracy|autonomy|suggestions/i,
    );
  });

  // Pitch 10: general model accuracy moved behind the admin boundary. Pitch 11
  // (PME-4/D9) renamed it to Model Performance at `/model-performance`. It
  // remains an admin-group surface, not a shared viewer read.
  it("keeps Model Performance admin-only and in the admin group", () => {
    const modelPerformance = SECTIONS.find(
      (s) => s.href === "/model-performance",
    );
    expect(modelPerformance).toBeDefined();
    expect(modelPerformance?.label).toBe("Model Performance");
    expect(modelPerformance?.adminOnly).toBe(true);
    expect(modelPerformance?.adminGroup).toBe(true);
  });

  // The viewer-facing product is exactly two primary tabs; the admin's extra
  // surfaces live under the Admin control, not among the primary tabs.
  it("gives both roles the same two primary tabs", () => {
    expect(primaryTabs("viewer").map((s) => s.label)).toEqual([
      "Slate",
      "Prop Research",
    ]);
    expect(primaryTabs("admin").map((s) => s.label)).toEqual([
      "Slate",
      "Prop Research",
    ]);
  });

  // The Admin control gathers every admin-group surface for the admin, and is
  // empty for a viewer so the control itself never renders for them.
  it("gathers admin surfaces for the admin and nothing for a viewer", () => {
    expect(adminSections("admin").map((s) => s.label)).toEqual([
      "Model Performance",
      "Paper Bot",
      "Health",
      "Users",
    ]);
    expect(adminSections("viewer")).toEqual([]);
  });

  // Suggestions was removed from navigation entirely (owner decision): pending
  // accept/decline already lives inline on the Slate. The `/suggestions` route
  // and its reads remain intact, but it is no longer a nav destination.
  it("has no Suggestions nav entry", () => {
    expect(SECTIONS.some((s) => s.href === "/suggestions")).toBe(false);
  });

  it("lists no route that does not exist yet", () => {
    // A nav item leading to a page that explains itself is still a nav item
    // implying a feature. Backtests and Decisions arrive with the pitches
    // that build them.
    const hrefs = SECTIONS.map((s) => s.href);
    expect(hrefs).not.toContain("/backtests");
    expect(hrefs).not.toContain("/decisions");
  });
});
