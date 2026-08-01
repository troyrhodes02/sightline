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
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import { NumericText } from "@/components/primitives/NumericText";
import { RoleChip } from "@/components/primitives/RoleChip";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { AccessRowDto } from "@/lib/dto/access";

/** Issue dates render as dates; relative age is for activity only. */
function asDate(iso: string): string {
  return iso.slice(0, 10);
}

function asRelative(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Now" : `${days}d`;
}

/**
 * Access management. Deliberately the smallest surface that satisfies
 * invitation creation, current-access visibility, and immediate revocation.
 *
 * Rows carry identity and status only — never a password field, never a
 * credential, never anything about positions, and no row is a link, because
 * there is no per-user content to open.
 */
export function Users({ rows }: { rows: AccessRowDto[] }) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<AccessRowDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function completed(message: string) {
    setNotice(message);
    // Re-read from the server rather than mutating local state, so what is
    // displayed is what the database actually holds.
    router.refresh();
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
        }}
      >
        <Typography variant="h1">Users</Typography>
        <Button variant="contained" onClick={() => setInviting(true)}>
          Invite viewer
        </Button>
      </Stack>

      <Paper sx={{ display: { xs: "none", md: "block" }, overflow: "hidden" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Invited</TableCell>
              <TableCell>Last active</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} sx={{ height: 52 }}>
                <TableCell sx={{ maxWidth: 210 }}>
                  <Typography
                    variant="body1"
                    noWrap
                    title={row.displayName ?? row.email}
                    sx={{ color: row.displayName ? undefined : "text.muted" }}
                  >
                    {/* Never a blank cell, never a system id. */}
                    {row.displayName ?? row.email}
                  </Typography>
                </TableCell>

                <TableCell sx={{ maxWidth: 240 }}>
                  <Typography variant="body1" noWrap title={row.email}>
                    {row.email}
                  </Typography>
                </TableCell>

                <TableCell>
                  <Stack direction="row" spacing={1}>
                    <RoleChip role={row.role} />
                    {row.pending ? (
                      <StatusChip label="Pending" tone="caution" />
                    ) : null}
                  </Stack>
                </TableCell>

                <TableCell>
                  <NumericText size="sm" sx={{ color: "text.secondary" }}>
                    {asDate(row.invitedAt)}
                  </NumericText>
                </TableCell>

                <TableCell>
                  <NumericText size="sm" muted={!row.lastActiveAt}>
                    {asRelative(row.lastActiveAt) ?? "—"}
                  </NumericText>
                </TableCell>

                <TableCell align="right">
                  {/* Absent on your own row, not rendered disabled. */}
                  {row.isSelf ? null : (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setRevoking(row)}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* At xs the table becomes a list. It never gains a scroll container. */}
      <Paper sx={{ display: { xs: "block", md: "none" } }}>
        <Stack
          divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}
        >
          {rows.map((row) => (
            <Stack key={row.id} spacing={1} sx={{ p: 2 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography variant="body1" noWrap>
                  {row.displayName ?? row.email}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <RoleChip role={row.role} />
                  {row.pending ? (
                    <StatusChip label="Pending" tone="caution" />
                  ) : null}
                </Stack>
              </Stack>

              {row.displayName ? (
                <Typography
                  variant="caption"
                  sx={{ color: "text.muted", overflowWrap: "anywhere" }}
                >
                  {row.email}
                </Typography>
              ) : null}

              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <NumericText size="sm" sx={{ color: "text.secondary" }}>
                  {`Invited ${asDate(row.invitedAt)}${
                    row.lastActiveAt
                      ? ` · Last ${asRelative(row.lastActiveAt)}`
                      : ""
                  }`}
                </NumericText>
                {row.isSelf ? null : (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => setRevoking(row)}
                  >
                    Revoke
                  </Button>
                )}
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Paper>

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onInvited={(email) => {
          setInviting(false);
          completed(`Invitation sent to ${email}`);
        }}
      />

      <RevokeDialog
        row={revoking}
        onClose={() => setRevoking(null)}
        onRevoked={(email) => {
          setRevoking(null);
          completed(`Access revoked for ${email}`);
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

function InviteDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"viewer" | "admin">("viewer");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          displayName: displayName.trim() || undefined,
        }),
      });

      if (response.ok) {
        onInvited(email);
        setEmail("");
        setDisplayName("");
        setRole("viewer");
        return;
      }

      // Inline in the dialog, never only in a snackbar. The typed email
      // survives so the admin does not retype it.
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "The invitation could not be sent.");
    } catch {
      setError("The invitation could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen}>
      <form onSubmit={submit}>
        <DialogTitle>Invite a user</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {error ? (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            ) : null}

            <TextField
              label="Email"
              type="email"
              autoComplete="off"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />

            {/*
              Resolved Decisions #2, and a deliberate deviation from design doc
              §Screen 6. Without it nothing ever sets a display name and the
              Users list renders a dash for every account permanently.
            */}
            <TextField
              label="Display name (optional)"
              autoComplete="off"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />

            <FormControl>
              <FormLabel sx={{ typography: "label", mb: 1 }}>Role</FormLabel>
              <RadioGroup
                row
                value={role}
                onChange={(e) => setRole(e.target.value as "viewer" | "admin")}
              >
                <FormControlLabel
                  value="viewer"
                  control={<Radio size="small" />}
                  label="Viewer"
                />
                <FormControlLabel
                  value="admin"
                  control={<Radio size="small" />}
                  label="Admin"
                />
              </RadioGroup>
              <Typography variant="caption" sx={{ color: "text.muted" }}>
                Viewers see the shared analytical surfaces. They cannot log
                decisions or trade.
              </Typography>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={submitting || !email}
          >
            Invite
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function RevokeDialog({
  row,
  onClose,
  onRevoked,
}: {
  row: AccessRowDto | null;
  onClose: () => void;
  onRevoked: (email: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function revoke() {
    if (!row) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/users/${row.id}/revoke`, {
        method: "POST",
      });

      if (response.ok) {
        onRevoked(row.email);
        return;
      }

      // The row stays in place. Never optimistic: a row vanishing while the
      // person still has access is the worst outcome on this screen.
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "Access could not be revoked. Try again.");
    } catch {
      setError("Access could not be revoked. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={row !== null} onClose={onClose}>
      <DialogTitle>Revoke access</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          {/*
            Names the person. "Are you sure?" is a shrug, not a confirmation.
            The address is un-truncated here even where the table clips it.
          */}
          <Typography variant="body1" sx={{ overflowWrap: "anywhere" }}>
            Revoke access for {row?.email}? They will be signed out immediately.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={revoke}
          disabled={submitting}
        >
          Revoke
        </Button>
      </DialogActions>
    </Dialog>
  );
}
