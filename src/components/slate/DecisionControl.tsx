"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import type { Disposition } from "../../../generated/prisma/enums";

/**
 * Take / Fade / Skip — the custom control the brand system names as one of
 * its few sanctioned custom components. Three equal-weight buttons: no
 * default, no visual push toward Take, and no unmark. Re-tapping the active
 * disposition does nothing. `T`/`F`/`S` work while the detail has focus
 * (ignored while typing in a field).
 *
 * The POST carries the contract id and the disposition — the server reads
 * every snapshot value itself. On failure the control keeps its prior visual
 * state; a decision that did not save must not look saved.
 */
export function DecisionControl({
  contractId,
  current,
}: {
  contractId: string;
  current: Disposition | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const submit = async (disposition: Disposition) => {
    if (busy || disposition === current) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, disposition }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(payload?.message ?? "The decision was not saved.");
        return;
      }
      setConfirmation(
        current ? `Changed to ${disposition}` : `Marked as ${disposition}`,
      );
      router.refresh();
    } catch {
      setError("The decision was not saved.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "t") void submit("took");
      else if (key === "f") void submit("faded");
      else if (key === "s") void submit("skipped");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, current, contractId]);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1}>
        <Button
          fullWidth
          variant={current === "took" ? "contained" : "outlined"}
          color="primary"
          disabled={busy}
          onClick={() => submit("took")}
          aria-pressed={current === "took"}
        >
          Take
        </Button>
        <Button
          fullWidth
          variant={current === "faded" ? "contained" : "outlined"}
          color="error"
          disabled={busy}
          onClick={() => submit("faded")}
          aria-pressed={current === "faded"}
        >
          Fade
        </Button>
        <Button
          fullWidth
          variant={current === "skipped" ? "contained" : "outlined"}
          color="inherit"
          disabled={busy}
          onClick={() => submit("skipped")}
          aria-pressed={current === "skipped"}
          sx={{ color: "text.secondary", borderColor: "border.strong" }}
        >
          Skip
        </Button>
      </Stack>
      {error ? (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      ) : null}
      <Snackbar
        open={confirmation !== null}
        autoHideDuration={3000}
        onClose={() => setConfirmation(null)}
        message={confirmation ?? ""}
      />
    </Stack>
  );
}
