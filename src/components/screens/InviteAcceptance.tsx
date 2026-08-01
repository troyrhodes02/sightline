"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { SightlineLockup } from "@/components/brand/SightlineLockup";
import { EmptyState } from "@/components/primitives/EmptyState";
import { RoleChip } from "@/components/primitives/RoleChip";
import type { InvitationState } from "@/lib/auth/invitation-state";

const SIGN_IN = { label: "Go to sign in", href: "/sign-in" };

/**
 * The failure copy. Four states, each with its own words.
 *
 * **None of them reveals anything** — not the invited address, not the role,
 * not the expiry, not who issued it. An unknown token and a revoked one are
 * equally uninformative, so nothing can be learned by comparing two responses.
 */
const FAILURES: Record<
  Exclude<InvitationState, "valid">,
  { title: string; detail?: string }
> = {
  expired: {
    title: "This invitation has expired.",
    detail: "Ask William to send a new one.",
  },
  used: {
    title: "This invitation has already been used.",
    detail: "If the account is yours, sign in.",
  },
  revoked: { title: "This invitation is no longer valid." },
  invalid: {
    title: "This invitation link is not valid.",
    detail: "Check that you copied the whole link.",
  },
};

function Frame({ children }: { children: React.ReactNode }) {
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
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 360 }}>
        <SightlineLockup height={28} />
        {children}
      </Stack>
    </Box>
  );
}

export type InviteAcceptanceProps =
  | { state: "valid"; token: string; email: string; role: "admin" | "viewer" }
  | { state: Exclude<InvitationState, "valid"> };

export function InviteAcceptance(props: InviteAcceptanceProps) {
  if (props.state !== "valid") {
    const copy = FAILURES[props.state];
    return (
      <Frame>
        <EmptyState title={copy.title} detail={copy.detail} action={SIGN_IN} />
      </Frame>
    );
  }

  return (
    <Frame>
      <AcceptForm token={props.token} email={props.email} role={props.role} />
    </Frame>
  );
}

function AcceptForm({
  token,
  email,
  role,
}: {
  token: string;
  email: string;
  role: "admin" | "viewer";
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFieldError({});
    setFailed(false);

    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      if (response.ok) {
        const { redirectTo } = (await response.json()) as {
          redirectTo: string;
        };
        router.replace(redirectTo);
        router.refresh();
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

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3}>
      <Typography variant="h2">You have been invited to Sightline.</Typography>

      {failed ? (
        <Alert severity="error" role="alert">
          Account setup failed. Try again in a moment.
        </Alert>
      ) : null}

      {/* Read-only. An invitation is TO an address, at a role — neither is the
          invitee's to choose, and the route rejects a body that supplies them. */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="body1" sx={{ overflowWrap: "anywhere" }}>
          {email}
        </Typography>
        <RoleChip role={role} />
      </Stack>

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
        Create account
      </Button>
    </Stack>
  );
}
