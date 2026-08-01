"use client";

import Box from "@mui/material/Box";
import { ApplicationError } from "@/components/screens/Terminal";

/**
 * The application error boundary.
 *
 * The `error` object is deliberately unused: nothing about it reaches the
 * screen. A message, a digest, or a stack trace here is a leak with good
 * intentions — and in a product holding a Kalshi signing key from Pitch 11
 * onward, the habit matters more than this particular page does.
 */
export default function GlobalError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <Box
      sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 2 }}
    >
      <Box sx={{ width: "100%", maxWidth: 480 }}>
        <ApplicationError onRetry={reset} />
      </Box>
    </Box>
  );
}
