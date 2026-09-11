export type Section = {
  label: string;
  href: string;
  adminOnly: boolean;
  /** Reached from the account menu and the mobile drawer, not the tab bar. */
  drawerOnly?: boolean;
  /**
   * Belongs to the admin area rather than the viewer-facing primary tabs.
   * Admin-group sections are gathered under a single "Admin" control instead of
   * sitting as peers of the Slate. Implies `adminOnly`.
   */
  adminGroup?: boolean;
};

/**
 * The single source for navigation, feeding both the desktop tabs and the
 * mobile drawer — so the two can never disagree about what exists.
 *
 * **Only routes that exist appear here.** Backtests and Decisions are added by
 * the pitches that build them; a nav item leading to a page that explains
 * itself is still a nav item implying a feature.
 *
 * The viewer-facing product is exactly two destinations — Slate and Prop
 * Research — plus Settings. Everything analytical or operational (Model
 * Performance, Autonomy, Suggestions, Health, Users) is `adminGroup`:
 * server-guarded and gathered under an "Admin" control rather than shown as a
 * peer of the Slate. Model Performance (the former Accuracy surface, renamed in
 * Pitch 11 — PME-4/D9) is an admin surface: general model quality is the
 * admin's evaluation machinery, not a shared viewer read. Suggestions is
 * likewise no longer a primary destination: its pending accept/decline lives
 * inline on the Slate, while its history and reliability analytics stay
 * reachable here.
 */
export const SECTIONS: Section[] = [
  { label: "Slate", href: "/slate", adminOnly: false },
  { label: "Prop Research", href: "/research", adminOnly: false },
  {
    label: "Model Performance",
    href: "/model-performance",
    adminOnly: true,
    adminGroup: true,
  },
  // Paper Bot (the former Autonomy surface, renamed in Pitch 11 — PME-6/D10).
  // The route base stays `/autonomy` (still an autonomous paper system, not
  // portfolio management), admin-only, three surfaces under one nav item.
  { label: "Paper Bot", href: "/autonomy", adminOnly: true, adminGroup: true },
  // Adjustment Suggestions: admin-only history and the private reliability
  // analytics. Pending accept/decline moved inline onto the Slate (Pitch 10),
  // so this is no longer a primary destination — it lives in the admin area.
  {
    label: "Suggestions",
    href: "/suggestions",
    adminOnly: true,
    adminGroup: true,
  },
  { label: "Health", href: "/health", adminOnly: true, adminGroup: true },
  { label: "Users", href: "/users", adminOnly: true, adminGroup: true },
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

/**
 * The viewer-facing primary tabs: everything that is neither admin-grouped nor
 * drawer-only. Identical for both roles today (Slate, Prop Research) — the
 * admin's extra surfaces live under the Admin control, not among these.
 */
export function primaryTabs(role: "admin" | "viewer"): Section[] {
  return visibleSections(role).filter(
    (section) => !section.adminGroup && !section.drawerOnly,
  );
}

/**
 * The admin area's sections, gathered under the "Admin" control. Empty for a
 * viewer, so the control itself never renders for them — absence, not a
 * disabled menu.
 */
export function adminSections(role: "admin" | "viewer"): Section[] {
  return visibleSections(role).filter((section) => section.adminGroup);
}
