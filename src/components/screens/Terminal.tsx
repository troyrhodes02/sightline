"use client";

import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { EmptyState } from "@/components/primitives/EmptyState";

const SLATE = { label: "Go to slate", href: "/slate" };

/**
 * A viewer reached an admin route.
 *
 * **The copy names no feature and no data**, and is identical for every admin
 * route — so nothing can be inferred by comparing two denials. "You need admin
 * access to view the decision log" would confirm the decision log exists, which
 * is precisely what a viewer must not be able to learn.
 *
 * No humour. No request-access affordance: there is one admin, and he is the
 * person who issues invitations.
 */
export function AccessDenied() {
  return (
    <Paper>
      <EmptyState title="You do not have access to this page." action={SLATE} />
    </Paper>
  );
}

export function NotFound() {
  return (
    <Paper>
      <EmptyState title="This page does not exist." action={SLATE} />
    </Paper>
  );
}

/**
 * An uncaught error.
 *
 * Never echoes an error code, a stack trace, a request id, or an upstream
 * provider message. `Try again` comes first because a transient failure is the
 * common case.
 */
export function ApplicationError({ onRetry }: { onRetry: () => void }) {
  return (
    <Paper>
      <Stack sx={{ alignItems: "center", pb: 8 }}>
        <EmptyState title="Something went wrong." />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mt: -4 }}
        >
          <Button variant="contained" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="outlined" href="/slate">
            Go to slate
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
