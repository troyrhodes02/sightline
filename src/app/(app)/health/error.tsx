"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * A failed health read.
 *
 * **Must not fall back to three "not yet implemented" rows.** A failed read and
 * a not-built job are different facts, and the whole purpose of this surface is
 * that it does not conflate them — reporting "the job does not exist" when the
 * truth is "we could not find out" is exactly the false reporting it exists to
 * prevent.
 */
export default function HealthError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">System health</Typography>
      <Alert
        severity="error"
        role="alert"
        action={
          <Button size="small" color="inherit" onClick={reset}>
            Retry
          </Button>
        }
      >
        Health could not be read.
      </Alert>
    </Stack>
  );
}
