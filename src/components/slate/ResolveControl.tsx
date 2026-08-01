"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

export type ResolveCandidate = { id: string; label: string };

/**
 * The minimal manual-mapping control — one contract, one correction, in
 * place. Candidates are server-selected and passed as props; this island
 * fetches nothing (the one sanctioned client fetch in this product is price
 * refresh, and this is not it). Confirming posts the player id — nothing
 * else — and the effect is future syncs only (RD-9).
 */
export function ResolveControl({
  contractId,
  kalshiName,
  candidates,
}: {
  contractId: string;
  kalshiName: string;
  candidates: ResolveCandidate[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ResolveCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const onConfirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contracts/${contractId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: selected.id }),
      });
      if (!response.ok) {
        setError("The mapping was not saved.");
        return;
      }
      setConfirmed(selected.label);
      router.refresh();
    } catch {
      setError("The mapping was not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Autocomplete
        options={candidates}
        value={selected}
        onChange={(_, value) => setSelected(value)}
        renderInput={(params) => (
          <TextField {...params} label="Resolve to player" size="small" />
        )}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        noOptionsText="No matching players"
      />
      {selected ? (
        <Typography variant="caption" sx={{ color: "text.muted" }}>
          Map “{kalshiName}” to {selected.label}? Future contracts with this
          name will resolve automatically. History already recorded is
          unchanged.
        </Typography>
      ) : null}
      {error ? (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      ) : null}
      <Stack direction="row">
        <Button
          variant="contained"
          size="small"
          disabled={!selected || busy}
          onClick={onConfirm}
        >
          Confirm mapping
        </Button>
      </Stack>
      <Snackbar
        open={confirmed !== null}
        autoHideDuration={4000}
        onClose={() => setConfirmed(null)}
        message={confirmed ? `Contract resolved to ${confirmed}` : ""}
      />
    </Stack>
  );
}
