"use client";

import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { theme } from "./index";

/**
 * Client boundary for the theme.
 *
 * The theme carries function-valued `styleOverrides`, and a Server Component
 * cannot pass a function to a Client Component — the build fails outright
 * rather than degrading. Importing the theme *inside* a client module keeps it
 * on the correct side of the boundary, and leaves the root layout a Server
 * Component so `metadata` still works.
 *
 * `defaultMode="system"` is the product default: appearance is selectable in
 * Settings and nowhere else.
 */
export function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
