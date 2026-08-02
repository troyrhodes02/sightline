export type Section = {
  label: string;
  href: string;
  adminOnly: boolean;
  /** Reached from the account menu and the mobile drawer, not the tab bar. */
  drawerOnly?: boolean;
};

/**
 * The single source for navigation, feeding both the desktop tabs and the
 * mobile drawer — so the two can never disagree about what exists.
 *
 * **Only routes that exist appear here.** Backtests and Decisions are added
 * by the pitches that build them; a nav item leading to a page that explains
 * itself is still a nav item implying a feature. Accuracy is shared: model
 * calibration is visible to viewers, while the overrides layer beneath it
 * stays admin-only at the route, not in the nav.
 */
export const SECTIONS: Section[] = [
  { label: "Slate", href: "/slate", adminOnly: false },
  { label: "Accuracy", href: "/accuracy", adminOnly: false },
  { label: "Health", href: "/health", adminOnly: true },
  { label: "Users", href: "/users", adminOnly: true },
  { label: "Settings", href: "/settings", adminOnly: false, drawerOnly: true },
];

/**
 * Filters sections by role.
 *
 * **This is a courtesy, not the boundary.** Every admin route rejects a viewer
 * server-side regardless of what navigation shows. Filtering exists so a viewer
 * cannot infer the private layer's existence from the interface — absence, not
 * a disabled item with a lock on it.
 */
export function visibleSections(role: "admin" | "viewer"): Section[] {
  return SECTIONS.filter((section) => !section.adminOnly || role === "admin");
}
