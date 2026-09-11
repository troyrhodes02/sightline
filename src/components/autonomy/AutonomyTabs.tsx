"use client";

import Box from "@mui/material/Box";
import Link from "next/link";

/**
 * The secondary navigation inside the Paper Bot section (PME-6, D10).
 *
 * Three surfaces under ONE top-level nav item, collapsed from the former seven:
 * Performance (the landing), Activity (positions + cycle diagnostics), and
 * Settings (bankroll, risk, withdrawal, model selection). Cycles, Positions,
 * Review, Readiness and Configuration are absorbed into these three; Dry Run is
 * retired entirely (D7). The shell's tab bar names the parts of the product a
 * person moves between, and Paper Bot is one of them; its internals are a
 * section, not seven peers of the slate.
 *
 * A client component only because it passes `component={Link}`-style hrefs and
 * marks the current tab; it holds no state and fetches nothing.
 */
const TABS = [
  { label: "Performance", href: "/autonomy" },
  { label: "Activity", href: "/autonomy/activity" },
  { label: "Settings", href: "/autonomy/settings" },
] as const;

export function AutonomyTabs({ current }: { current: string }) {
  return (
    <Box
      component="nav"
      aria-label="Paper Bot sections"
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
