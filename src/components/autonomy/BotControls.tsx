"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * The per-bot controls (design doc §9): rename and pause/resume.
 *
 * Both call `POST /api/paper/bots/[id]` and never touch the data store. "Kill" a
 * paper bot is a pause — its ledger is history that is never destroyed — so the
 * terminal control stops new positions rather than deleting anything, and its
 * copy says so. A failed action surfaces inline and does not clear the state it
 * failed to change.
 */
export function BotControls({
  botId,
  name,
  autonomyEnabled,
}: {
  botId: string;
  name: string;
  autonomyEnabled: boolean;
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/paper/bots/${botId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(payload?.message ?? "The action did not take effect.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("The action did not take effect. Retry.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function submitRename() {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setError("A bot name cannot be empty.");
      return;
    }
    const ok = await post({ action: "rename", name: trimmed });
    if (ok) setRenameOpen(false);
  }

  return (
    <Stack spacing={1} sx={{ alignItems: { xs: "stretch", sm: "flex-end" } }}>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => {
            setDraftName(name);
            setError(null);
            setRenameOpen(true);
          }}
          disabled={pending}
        >
          Rename
        </Button>
        {autonomyEnabled ? (
          <Button
            variant="outlined"
            size="small"
            onClick={() => post({ action: "pause" })}
            disabled={pending}
            sx={{ color: "error.main", borderColor: "error.main" }}
          >
            Pause
          </Button>
        ) : (
          <Button
            variant="outlined"
            size="small"
            onClick={() => post({ action: "resume" })}
            disabled={pending}
          >
            Resume
          </Button>
        )}
      </Stack>

      {error && !renameOpen ? (
        <Typography variant="body2" sx={{ color: "error.main" }} role="alert">
          {error}
        </Typography>
      ) : null}

      <Dialog
        open={renameOpen}
        onClose={() => {
          if (!pending) setRenameOpen(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Rename bot</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              required
              fullWidth
              autoFocus
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            {error ? (
              <Typography
                variant="body2"
                sx={{ color: "error.main" }}
                role="alert"
              >
                {error}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="outlined" onClick={submitRename} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
