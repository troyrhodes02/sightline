import Paper from "@mui/material/Paper";
import { EmptyState } from "@/components/primitives/EmptyState";

const SLATE = { label: "Go to slate", href: "/slate" };

/**
 * A viewer reached an admin route.
 *
 * The copy names no feature and no data. It is the same for every admin route,
 * so nothing can be inferred by comparing two denials.
 */
export function AccessDenied() {
  return (
    <Paper>
      <EmptyState title="You do not have access to this page." action={SLATE} />
    </Paper>
  );
}
