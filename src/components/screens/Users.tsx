"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { RoleChip } from "@/components/primitives/RoleChip";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { AccessRowDto } from "@/lib/dto/access";

type Action = "approve" | "deny" | "revoke";

/** Requests carry a date; activity carries a relative age. */
function asDate(iso: string): string {
  return iso.slice(0, 10);
}

function asRelative(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Now" : `${days}d`;
}

const CONFIRM: Record<
  Action,
  (email: string) => { title: string; body: string; verb: string }
> = {
  approve: (email) => ({
    title: "Approve access",
    body: `Approve ${email}? They will be able to sign in immediately, with viewer access.`,
    verb: "Approve",
  }),
  deny: (email) => ({
    title: "Deny request",
    body: `Deny the request from ${email}? They will not be able to sign in, and the decision is final — a new request would have to be made.`,
    verb: "Deny",
  }),
  revoke: (email) => ({
    title: "Revoke access",
    body: `Revoke access for ${email}? They will be signed out immediately.`,
    verb: "Revoke",
  }),
};

/**
 * Access management.
 *
 * Two groups, deliberately apart: **requests are a queue** — rows that have
 * been granted nothing and are waiting on the admin — and members are the
 * roster. Merging them would bury the only thing on this page that needs doing.
 *
 * Rows carry identity and status only. Never a password field, never a
 * credential, never anything about positions, and no row is a link, because
 * there is no per-account content to open.
 */
export function Users({
  pending,
  members,
}: {
  pending: AccessRowDto[];
  members: AccessRowDto[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<{
    row: AccessRowDto;
    action: Action;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Stack spacing={4}>
      <Typography variant="h1">Users</Typography>

      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
          <Typography variant="h2">Requests</Typography>
          {pending.length > 0 ? (
            <NumericText size="sm" sx={{ color: "text.secondary" }}>
              {String(pending.length)}
            </NumericText>
          ) : null}
        </Stack>

        <Paper>
          {pending.length === 0 ? (
            // A legitimate answer, not a failure. Most days there is nothing
            // here, and the screen should read as settled rather than broken.
            <EmptyState title="No requests waiting." />
          ) : (
            <Stack
              divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}
            >
              {pending.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  meta={`Requested ${asDate(row.requestedAt)}`}
                  chip={<StatusChip label="Pending" tone="caution" />}
                  actions={
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() =>
                          setConfirming({ row, action: "approve" })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => setConfirming({ row, action: "deny" })}
                      >
                        Deny
                      </Button>
                    </>
                  }
                />
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>

      <Stack spacing={1.5}>
        <Typography variant="h2">Members</Typography>
        <Paper>
          <Stack
            divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}
          >
            {members.map((row) => (
              <Row
                key={row.id}
                row={row}
                meta={`Joined ${asDate(row.requestedAt)}${
                  row.lastActiveAt
                    ? ` · Last ${asRelative(row.lastActiveAt)}`
                    : ""
                }`}
                chip={<RoleChip role={row.role} />}
                actions={
                  // Absent on your own row, not rendered disabled.
                  row.isSelf ? null : (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setConfirming({ row, action: "revoke" })}
                    >
                      Revoke
                    </Button>
                  )
                }
              />
            ))}
          </Stack>
        </Paper>
      </Stack>

      <ConfirmDialog
        pendingAction={confirming}
        onClose={() => setConfirming(null)}
        onDone={(message) => {
          setConfirming(null);
          setNotice(message);
          // Re-read from the server rather than mutating local state, so what
          // is displayed is what the database actually holds.
          router.refresh();
        }}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>
    </Stack>
  );
}

function Row({
  row,
  meta,
  chip,
  actions,
}: {
  row: AccessRowDto;
  meta: string;
  chip: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <Stack
      // Stable hook for the end-to-end suite. Anchoring tests on DOM shape
      // breaks every time this screen is restructured, and it has been a table
      // and a Stack already.
      data-account={row.email}
      direction={{ xs: "column", sm: "row" }}
      spacing={1}
      sx={{
        p: 2,
        alignItems: { xs: "stretch", sm: "center" },
        justifyContent: "space-between",
      }}
    >
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {/* Never a blank cell, never a system id. */}
          <Typography
            variant="body1"
            noWrap
            title={row.displayName ?? row.email}
            sx={{ color: row.displayName ? undefined : "text.muted" }}
          >
            {row.displayName ?? row.email}
          </Typography>
          {chip}
        </Stack>
        {row.displayName ? (
          <Typography
            variant="caption"
            sx={{ color: "text.muted", overflowWrap: "anywhere" }}
          >
            {row.email}
          </Typography>
        ) : null}
        <NumericText size="sm" sx={{ color: "text.secondary" }}>
          {meta}
        </NumericText>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
        {actions}
      </Stack>
    </Stack>
  );
}

function ConfirmDialog({
  pendingAction,
  onClose,
  onDone,
}: {
  pendingAction: { row: AccessRowDto; action: Action } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const copy = pendingAction
    ? CONFIRM[pendingAction.action](pendingAction.row.email)
    : null;

  async function submit() {
    if (!pendingAction) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/users/${pendingAction.row.id}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: pendingAction.action }),
        },
      );

      if (response.ok) {
        const past = {
          approve: "Approved",
          deny: "Denied",
          revoke: "Access revoked for",
        }[pendingAction.action];
        onDone(`${past} ${pendingAction.row.email}`);
        return;
      }

      // The row stays. Never optimistic: a row vanishing while the person still
      // has access is the worst outcome on this screen.
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "That did not work. Try again.");
    } catch {
      setError("That did not work. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={pendingAction !== null} onClose={onClose}>
      <DialogTitle>{copy?.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          {/* Names the person. "Are you sure?" is a shrug, not a confirmation.
              The address is un-truncated here even where a row clips it. */}
          <Typography variant="body1" sx={{ overflowWrap: "anywhere" }}>
            {copy?.body}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={pendingAction?.action === "approve" ? "primary" : "error"}
          onClick={submit}
          disabled={submitting}
        >
          {copy?.verb}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
