"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

export type EmptyStateAction = { label: string; href: string };

/**
 * The one empty / unavailable / terminal primitive, reused by the slate
 * placeholder, all four invitation failure states, access denied, not found,
 * and the application error.
 *
 * **No icon, no illustration, no artwork.** Placeholder imagery in this product
 * is a chart with no data in it, rendered honestly. If a screen feels bare the
 * answer is better hierarchy, not a picture — and an encouraging empty state
 * would be actively wrong in a product that must be able to say *nothing here
 * has an edge today* and have that read as a legitimate answer.
 *
 * Copy is flat and declarative: no coaching language, no exclamation marks.
 *
 * A client component because it passes `component={Link}` to MUI's Button, and
 * a Server Component cannot hand a function to a Client Component — the build
 * fails rather than degrading. The alternative, a bare `href`, would drop
 * client-side navigation from every empty state in the product.
 */
export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: EmptyStateAction;
}) {
  return (
    <Stack
      spacing={2}
      sx={{ px: 3, py: 8, textAlign: "center", alignItems: "center" }}
    >
      <Typography variant="h2" sx={{ color: "text.primary" }}>
        {title}
      </Typography>

      {detail ? (
        <Typography
          variant="body1"
          sx={{ color: "text.secondary", maxWidth: 420 }}
        >
          {detail}
        </Typography>
      ) : null}

      {action ? (
        <Button
          component={Link}
          href={action.href}
          variant="outlined"
          sx={{ mt: 1 }}
        >
          {action.label}
        </Button>
      ) : null}
    </Stack>
  );
}
