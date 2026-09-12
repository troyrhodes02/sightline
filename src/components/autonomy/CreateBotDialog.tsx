"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

type Engine = "baseline" | "simulation" | "hybrid";
type Mode = "conservative" | "moderate" | "aggressive";

/**
 * The Paper Bot Lab create form (design doc §9).
 *
 * An interactive island — it calls the `POST /api/paper/bots` route handler and
 * never touches the data store. On success it routes to the new bot's detail so
 * the admin lands on the thing they just made. Client-side validation gates the
 * Start button; a server error surfaces inline rather than as a toast that
 * disappears.
 *
 * Starting bankroll is entered in whole dollars and converted to cents at the
 * boundary — the route contract is cents. Withdrawal ceiling is a × multiple.
 */
export function CreateBotDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [engine, setEngine] = useState<Engine>("hybrid");
  const [mode, setMode] = useState<Mode>("moderate");
  const [bankrollDollars, setBankrollDollars] = useState("1000");
  const [ceiling, setCeiling] = useState("1.5");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const bankroll = Number(bankrollDollars);
  const ceilingValue = Number(ceiling);
  const nameValid = trimmedName.length > 0;
  const bankrollValid = Number.isFinite(bankroll) && bankroll > 0;
  const ceilingValid =
    Number.isFinite(ceilingValue) && ceilingValue >= 1 && ceilingValue <= 100;
  const valid = nameValid && bankrollValid && ceilingValid;

  const [touched, setTouched] = useState(false);

  function reset() {
    setName("");
    setEngine("hybrid");
    setMode("moderate");
    setBankrollDollars("1000");
    setCeiling("1.5");
    setError(null);
    setTouched(false);
  }

  function handleClose() {
    if (pending) return;
    reset();
    onClose();
  }

  async function start() {
    setTouched(true);
    if (!valid) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/paper/bots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          engine,
          mode,
          startingBankrollCents: Math.round(bankroll * 100),
          withdrawalCeilingMultiple: ceilingValue,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        botId?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.botId) {
        setError(payload?.message ?? "The bot could not be created.");
        return;
      }
      reset();
      onClose();
      router.push(`/autonomy/bots/${payload.botId}`);
      router.refresh();
    } catch {
      setError(
        "The bot could not be created. Check your connection and retry.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>New bot</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            fullWidth
            autoFocus
            error={touched && !nameValid}
            helperText={
              touched && !nameValid ? "A bot needs a name." : undefined
            }
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />

          <FieldGroup label="Engine">
            <ToggleButtonGroup
              value={engine}
              exclusive
              size="small"
              onChange={(_event, value: Engine | null) => {
                if (value) setEngine(value);
              }}
            >
              <ToggleButton value="baseline">Baseline</ToggleButton>
              <ToggleButton value="simulation">Simulation</ToggleButton>
              <ToggleButton value="hybrid">Hybrid</ToggleButton>
            </ToggleButtonGroup>
          </FieldGroup>

          <FieldGroup label="Risk mode">
            <ToggleButtonGroup
              value={mode}
              exclusive
              size="small"
              onChange={(_event, value: Mode | null) => {
                if (value) setMode(value);
              }}
            >
              <ToggleButton value="conservative">Conservative</ToggleButton>
              <ToggleButton value="moderate">Moderate</ToggleButton>
              <ToggleButton value="aggressive">Aggressive</ToggleButton>
            </ToggleButtonGroup>
          </FieldGroup>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Starting bankroll"
              value={bankrollDollars}
              onChange={(event) => setBankrollDollars(event.target.value)}
              type="number"
              fullWidth
              error={touched && !bankrollValid}
              helperText={
                touched && !bankrollValid
                  ? "Enter an amount above zero."
                  : undefined
              }
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">$</InputAdornment>
                  ),
                },
                htmlInput: { min: 0, step: 100 },
              }}
            />
            <TextField
              label="Withdrawal ceiling"
              value={ceiling}
              onChange={(event) => setCeiling(event.target.value)}
              type="number"
              fullWidth
              error={touched && !ceilingValid}
              helperText={
                touched && !ceilingValid
                  ? "Between 1× and 100×."
                  : "Multiple of starting bankroll"
              }
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">×</InputAdornment>
                  ),
                },
                htmlInput: { min: 1, max: 100, step: 0.1 },
              }}
            />
          </Stack>

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
        <Button onClick={handleClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="outlined" onClick={start} disabled={pending}>
          {pending ? "Starting…" : "Start"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      {children}
    </Stack>
  );
}
