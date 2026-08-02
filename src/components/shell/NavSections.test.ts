import { SECTIONS, visibleSections } from "./NavSections";

describe("navigation sections", () => {
  it("gives a viewer only the shared surfaces", () => {
    const labels = visibleSections("viewer").map((s) => s.label);
    expect(labels).toEqual(["Slate", "Accuracy", "Settings"]);
  });

  it("gives an admin every surface", () => {
    const labels = visibleSections("admin").map((s) => s.label);
    expect(labels).toEqual([
      "Slate",
      "Accuracy",
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
    expect(JSON.stringify(viewer)).not.toMatch(/health|users/i);
  });

  // Accuracy is deliberately shared: model calibration is a viewer surface.
  // The overrides layer beneath it is guarded at the route, not the nav.
  it("shows Accuracy to viewers as a shared surface", () => {
    const accuracy = SECTIONS.find((s) => s.href === "/accuracy");
    expect(accuracy).toBeDefined();
    expect(accuracy?.adminOnly).toBe(false);
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
