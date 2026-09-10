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
      "Accuracy",
      "Autonomy",
      "Suggestions",
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

  // Pitch 10: general model accuracy moved behind the admin boundary. It is an
  // admin-group surface now, no longer a shared viewer read.
  it("keeps Accuracy admin-only and in the admin group", () => {
    const accuracy = SECTIONS.find((s) => s.href === "/accuracy");
    expect(accuracy).toBeDefined();
    expect(accuracy?.adminOnly).toBe(true);
    expect(accuracy?.adminGroup).toBe(true);
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
      "Accuracy",
      "Autonomy",
      "Suggestions",
      "Health",
      "Users",
    ]);
    expect(adminSections("viewer")).toEqual([]);
  });

  // Suggestions is no longer a primary destination: pending accept/decline
  // moved inline onto the Slate. It remains reachable in the admin area.
  it("keeps Suggestions reachable but out of the primary tabs", () => {
    const suggestions = SECTIONS.find((s) => s.href === "/suggestions");
    expect(suggestions?.adminGroup).toBe(true);
    expect(primaryTabs("admin").some((s) => s.href === "/suggestions")).toBe(
      false,
    );
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
