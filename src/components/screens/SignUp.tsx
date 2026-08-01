"use client";

import { useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SightlineLockup } from "@/components/brand/SightlineLockup";
import { EmptyState } from "@/components/primitives/EmptyState";

/**
 * Request an account.
 *
 * **Submitting grants nothing.** It creates a pending row that an admin must
 * approve, and the copy says so before the form is filled in rather than after
 * — a screen that looks like a sign-up and behaves like a queue is a screen
 * that generates support questions.
 *
 * The confirmation is identical whether or not the address already has an
 * account, because sign-up is a public surface and a distinct reply would let
 * anyone enumerate who is in the group.
 */
export function SignUp() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFieldError({});
    setFailed(false);

    try {
      const response = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          confirmPassword,
          displayName: displayName.trim() || undefined,
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        return;
      }

      const payload = (await response.json()) as {
        details?: Record<string, string>;
      };
      if (payload.details) setFieldError(payload.details);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Frame>
        <EmptyState
          title="Your request has been submitted."
          detail="You will be able to sign in once an admin approves it."
          action={{ label: "Go to sign in", href: "/sign-in" }}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <Stack component="form" onSubmit={onSubmit} spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h2">Request an account</Typography>
          {/* Stated up front, not discovered after submitting. */}
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Sightline is a closed tool. An admin reviews every request, and you
            will not have access until one is approved.
          </Typography>
        </Stack>

        {failed ? (
          <Alert severity="error" role="alert">
            Your request could not be submitted. Try again in a moment.
          </Alert>
        ) : null}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={Boolean(fieldError.email)}
          helperText={fieldError.email ?? " "}
          disabled={submitting}
        />

        <TextField
          label="Name (optional)"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={submitting}
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />

        <TextField
          label="Choose a password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={Boolean(fieldError.password)}
          // Stated before submission rather than revealed by failing.
          helperText={fieldError.password ?? "At least 12 characters."}
          disabled={submitting}
        />

        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={Boolean(fieldError.confirmPassword)}
          helperText={fieldError.confirmPassword ?? " "}
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
          Request access
        </Button>

        <Typography variant="caption" sx={{ color: "text.muted" }}>
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </Typography>
      </Stack>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 6,
        bgcolor: "background.default",
      }}
    >
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 380 }}>
        <SightlineLockup height={30} />
        {children}
      </Stack>
    </Box>
  );
}
