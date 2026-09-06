"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * A failed accuracy read — the database read itself. A delayed grading cycle
 * is NOT an error: it renders as a freshness disclosure over the last
 * completed results and must never land here.
 */
export default function AccuracyError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Accuracy</Typography>
      <Alert
        severity="error"
        role="alert"
        action={
          <Button size="small" color="inherit" onClick={reset}>
            Retry
          </Button>
        }
      >
        Accuracy is temporarily unavailable — the last completed results could
        not be read.
      </Alert>
    </Stack>
  );
}
