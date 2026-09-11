"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * A failed Model Performance read — the database or ledger read itself. A
 * delayed grading cycle is NOT an error: it renders as a freshness disclosure
 * over the last completed results and must never land here. A scope with no
 * data is a designed no-data state, not an error either.
 */
export default function ModelPerformanceError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Model Performance</Typography>
      <Alert
        severity="error"
        role="alert"
        action={
          <Button size="small" color="inherit" onClick={reset}>
            Retry
          </Button>
        }
      >
        Model performance is temporarily unavailable — the last completed
        results could not be read.
      </Alert>
    </Stack>
  );
}
