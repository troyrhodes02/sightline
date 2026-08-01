"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * A failed slate read — the database read itself, not Kalshi. Kalshi being
 * unreachable is a designed degraded mode handled inside the slate and must
 * never land here.
 */
export default function SlateError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Slate</Typography>
      <Alert
        severity="error"
        role="alert"
        action={
          <Button size="small" color="inherit" onClick={reset}>
            Retry
          </Button>
        }
      >
        The slate could not be loaded.
      </Alert>
    </Stack>
  );
}
