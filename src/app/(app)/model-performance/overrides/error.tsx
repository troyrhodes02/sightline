"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * A failed overrides read — the database read itself, never a partial render
 * where tiles show and tables error separately.
 */
export default function OverridesError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Overrides</Typography>
      <Alert
        severity="error"
        role="alert"
        action={
          <Button size="small" color="inherit" onClick={reset}>
            Retry
          </Button>
        }
      >
        Overrides are temporarily unavailable — the decision record could not be
        read.
      </Alert>
    </Stack>
  );
}
