import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prop Research · Sightline" };

/**
 * Prop Research — a shared, viewer-accessible destination introduced in Pitch
 * 10 alongside the admin-navigation split. This is the route stub: it exists so
 * the nav item resolves to a real authenticated page rather than a 404 while
 * the full probability checker (player search → game → stat → threshold, read
 * from stored distributions via `probAtLeast`) is built in SIG-98. It runs no
 * model and reads no price.
 */
export default async function ResearchPage() {
  await requireSession();
  return (
    <Box>
      <Typography variant="h1" gutterBottom>
        Prop Research
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Check Sightline&apos;s probability for any player, stat, and threshold
        on an upcoming game. Coming in this release.
      </Typography>
    </Box>
  );
}
