import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EmptyState } from "@/components/primitives/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Slate · Sightline" };

/**
 * The slate placeholder.
 *
 * **Issues no query and renders no skeleton.** It has nothing to fetch, and a
 * placeholder that shows a loading state first is pretending otherwise.
 *
 * No mock contracts, no sample rows, no illustrative numbers, no disabled
 * filter controls. Pitch 4 replaces this state; the route, the shell, and the
 * theme around it do not move.
 */
export default function SlatePage() {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Slate</Typography>
      <Paper>
        <EmptyState
          title="The slate is not yet available."
          detail="Contract listings, projections, and edges arrive with Kalshi market sync."
        />
      </Paper>
    </Stack>
  );
}
