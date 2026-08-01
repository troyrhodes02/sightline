"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SightlineLockup } from "@/components/brand/SightlineLockup";

type Failure = "credentials" | "unavailable" | null;

/**
 * Sign in. **Email and password only.**
 *
 * There is no signup link, no social auth, no magic link, and no "forgot
 * password". Their absence is a product commitment, not an oversight, and the
 * screen should read as deliberate about it rather than as though a link went
 * missing — which is why the footer states the access model outright.
 */
export function SignIn({
  revoked = false,
  redirectTo,
}: {
  revoked?: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<Failure>(null);
  const [submitting, setSubmitting] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // Move focus to the failure so a screen reader announces it rather than
  // leaving the user to discover it by re-reading the form.
  useEffect(() => {
    if (failure) alertRef.current?.focus();
  }, [failure]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFailure(null);

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, redirectTo }),
      });

      if (response.ok) {
        const { redirectTo: destination } = (await response.json()) as {
          redirectTo: string;
        };
        router.replace(destination);
        router.refresh();
        return;
      }

      const { error } = (await response.json()) as { error: string };
      setFailure(
        error === "upstream_unavailable" ? "unavailable" : "credentials",
      );
      // Email survives a failure; the password does not.
      setPassword("");
    } catch {
      setFailure("unavailable");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        px: 2,
        bgcolor: "background.default",
      }}
    >
      <Stack
        component="form"
        onSubmit={onSubmit}
        spacing={3}
        sx={{ width: "100%", maxWidth: 360 }}
      >
        <SightlineLockup height={28} />

        {revoked ? (
          <Alert severity="info" icon={false}>
            Your access to Sightline has been removed.
          </Alert>
        ) : null}

        {failure === "credentials" ? (
          <Alert severity="error" role="alert" ref={alertRef} tabIndex={-1}>
            Email or password is incorrect.
          </Alert>
        ) : null}

        {failure === "unavailable" ? (
          <Alert severity="error" role="alert" ref={alertRef} tabIndex={-1}>
            Sign-in is unavailable right now. Try again in a moment.
          </Alert>
        ) : null}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />

        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />

        <Button
          type="submit"
          variant="contained"
          disabled={submitting}
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : null
          }
        >
          Sign in
        </Button>

        <Typography variant="caption" sx={{ color: "text.muted" }}>
          Access to Sightline is by invitation.
        </Typography>
      </Stack>
    </Box>
  );
}
