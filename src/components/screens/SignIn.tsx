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
import Link from "next/link";
import { SightlineLockup } from "@/components/brand/SightlineLockup";
import { STATUS_MESSAGE, type SignInReason } from "@/lib/auth/account-status";

type Failure = "credentials" | "unavailable" | null;

/**
 * Sign in. **Email and password only.**
 *
 * No social auth, no magic link, and no "forgot password" — their absence is a
 * product commitment rather than an oversight.
 *
 * There IS a link to request an account, because account requests are how
 * people get in. It leads to a queue, not to access.
 *
 * `reason` reports the caller's own account status and is only ever reached
 * after they authenticated successfully, so it reveals nothing to a guesser.
 */
export function SignIn({
  reason,
  redirectTo,
}: {
  reason?: SignInReason;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<Failure>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(
    reason ? STATUS_MESSAGE[reason] : null,
  );
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
    setStatusMessage(null);

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

      const payload = (await response.json()) as {
        error: string;
        message: string;
      };
      if (payload.error === "forbidden") {
        // A status message, not a credential failure: they authenticated.
        setStatusMessage(payload.message);
      } else {
        setFailure(
          payload.error === "upstream_unavailable"
            ? "unavailable"
            : "credentials",
        );
      }
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
        sx={{ width: "100%", maxWidth: 380 }}
      >
        <SightlineLockup height={30} />

        {statusMessage ? (
          <Alert severity="info" icon={false} role="status">
            {statusMessage}
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
          Need an account? <Link href="/sign-up">Request access</Link>. Every
          request is reviewed by an admin before it is granted.
        </Typography>
      </Stack>
    </Box>
  );
}
