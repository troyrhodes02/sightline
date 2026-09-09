"use client";

import Box from "@mui/material/Box";
import Link from "next/link";

/**
 * The secondary navigation inside the Autonomy section.
 *
 * Seven surfaces under ONE top-level nav item rather than seven nav entries:
 * the shell's tab bar names the parts of the product a person moves between,
 * and autonomy is one of them. Its internals are a section, not seven peers of
 * the slate.
 *
 * A client component only because it passes `component={Link}`-style hrefs and
 * marks the current tab; it holds no state and fetches nothing.
 */
const TABS = [
  { label: "Overview", href: "/autonomy" },
  { label: "Cycles", href: "/autonomy/cycles" },
  { label: "Positions", href: "/autonomy/positions" },
  { label: "Review", href: "/autonomy/review" },
  { label: "Readiness", href: "/autonomy/readiness" },
  { label: "Dry Run", href: "/autonomy/dry-run" },
  { label: "Configuration", href: "/autonomy/configuration" },
] as const;

export function AutonomyTabs({ current }: { current: string }) {
  return (
    <Box
      component="nav"
      aria-label="Autonomy sections"
      sx={{
        display: "flex",
        gap: 0.25,
        flexWrap: "wrap",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      {TABS.map((tab) => {
        const active =
          tab.href === "/autonomy"
            ? current === "/autonomy"
            : current.startsWith(tab.href);
        return (
          <Box
            key={tab.href}
            component={Link}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            sx={{
              px: 1.5,
              py: 1,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
              color: active ? "primary.main" : "text.secondary",
              borderBottom: 2,
              borderColor: active ? "primary.main" : "transparent",
              "&:hover": { color: "text.primary" },
            }}
          >
            {tab.label}
          </Box>
        );
      })}
    </Box>
  );
}
