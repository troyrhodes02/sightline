"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { NumericText } from "@/components/primitives/NumericText";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import { AutonomyHeading, formatCents } from "@/components/autonomy/primitives";
import type { ConfigurationDto } from "@/lib/dto/autonomy";
import {
  CUSTOM_CAP_MAX_PCT,
  CUSTOM_CAP_MIN_PCT,
  CUSTOM_KELLY_MAX,
  KELLY_WARNING_THRESHOLD,
  PROBABILITY_CEILING,
  RISK_PRESETS,
} from "@/lib/paper/config";

type Mode = "conservative" | "moderate" | "aggressive" | "custom";

/**
 * Risk configuration.
 *
 * Four presets rather than fourteen sliders — the pitch is explicit that
 * presets should simplify Kelly and exposure configuration rather than create a
 * trading cockpit. Custom exposes the underlying values for deliberate tuning.
 *
 * A Kelly fraction above 0.75 is **valid**. It shows a persistent warning and
 * does not block: Custom exists precisely so the presets can be overridden on
 * purpose. Full Kelly assumes the probability is exactly right, and the whole
 * reason recalibration exists is that it is not.
 */
export function AutonomyConfiguration({
  config,
}: {
  config: ConfigurationDto;
}) {
  const router = useRouter();
  const current = config.mode;

  const [mode, setMode] = useState<Mode>(current?.mode ?? "conservative");
  const [kelly, setKelly] = useState(
    String(current?.kellyFraction ?? RISK_PRESETS.conservative.kellyFraction),
  );
  const [gameCap, setGameCap] = useState(
    String(current?.perGameCapPct ?? RISK_PRESETS.conservative.perGameCapPct),
  );
  const [slateCap, setSlateCap] = useState(
    String(current?.perSlateCapPct ?? RISK_PRESETS.conservative.perSlateCapPct),
  );
  const [halt, setHalt] = useState(
    String(
      current?.drawdownHaltPct ?? RISK_PRESETS.conservative.drawdownHaltPct,
    ),
  );
  const [startingDollars, setStartingDollars] = useState(
    (config.startingBankrollCents / 100).toFixed(2),
  );
  const [ceiling, setCeiling] = useState(
    String(current?.withdrawalCeilingMultiple ?? 1.5),
  );
  const [enabled, setEnabled] = useState(config.autonomyEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const kellyValue = Number(kelly);
  const gameValue = Number(gameCap);
  const slateValue = Number(slateCap);

  const capOrderError =
    mode === "custom" && slateValue < gameValue
      ? `The per-slate cap must be at least the per-game cap (${gameValue}%).`
      : null;
  const kellyRangeError =
    mode === "custom" && (kellyValue < 0 || kellyValue > CUSTOM_KELLY_MAX)
      ? `The Kelly fraction must be between 0 and ${CUSTOM_KELLY_MAX}.`
      : null;
  const invalid = Boolean(capOrderError || kellyRangeError);

  const kellyWarning =
    mode === "custom" && kellyValue > KELLY_WARNING_THRESHOLD;

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/autonomy/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ...(mode === "custom"
            ? {
                kellyFraction: kellyValue,
                perGameCapPct: gameValue,
                perSlateCapPct: slateValue,
                drawdownHaltPct: Number(halt),
              }
            : {}),
          ...(config.startingBankrollEditable
            ? {
                startingBankrollCents: Math.round(
                  Number(startingDollars) * 100,
                ),
              }
            : {}),
          withdrawalCeilingMultiple: Number(ceiling),
          autonomyEnabled: enabled,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          body?.message ?? "The configuration could not be saved.",
        );
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      // The form keeps every value, including the invalid one. A failed save
      // that discarded input would be a destructive error with good intentions.
      setError(
        caught instanceof Error
          ? caught.message
          : "The configuration could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Configuration"
        detail="Paper mode · all settings apply to simulated trading only"
      />
      <AutonomyTabs current="/autonomy/configuration" />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? (
        <Alert severity="success">
          Configuration saved. Applies to the next sizing decision; open
          positions keep the limits they were created under.
        </Alert>
      ) : null}

      <Box>
        <Typography variant="h2" sx={{ mb: 1.5 }}>
          Risk mode
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              lg: "repeat(4, 1fr)",
            },
            gap: 1.5,
          }}
        >
          {(["conservative", "moderate", "aggressive", "custom"] as const).map(
            (option) => (
              <ModeCard
                key={option}
                option={option}
                selected={mode === option}
                onSelect={() => setMode(option)}
                custom={{ kelly, gameCap, slateCap, halt }}
              />
            ),
          )}
        </Box>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
          Changing mode applies to the next sizing decision. Open positions keep
          the mode and limits they were created under.
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          The probability ceiling ({PROBABILITY_CEILING.toFixed(3)}) does not
          change with mode.
        </Typography>
      </Box>

      {mode === "custom" ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h2" sx={{ mb: 1.5 }}>
            Custom parameters
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "1fr 1fr",
                lg: "repeat(4, 1fr)",
              },
              gap: 2,
            }}
          >
            <TextField
              label="Kelly fraction ×"
              value={kelly}
              onChange={(event) => setKelly(event.target.value)}
              size="small"
              error={Boolean(kellyRangeError)}
              helperText={kellyRangeError ?? `0 to ${CUSTOM_KELLY_MAX}`}
            />
            <TextField
              label="Per-game cap %"
              value={gameCap}
              onChange={(event) => setGameCap(event.target.value)}
              size="small"
              helperText={`${CUSTOM_CAP_MIN_PCT} to ${CUSTOM_CAP_MAX_PCT}, of current active bankroll`}
            />
            <TextField
              label="Per-slate cap %"
              value={slateCap}
              onChange={(event) => setSlateCap(event.target.value)}
              size="small"
              error={Boolean(capOrderError)}
              helperText={
                capOrderError ??
                `${CUSTOM_CAP_MIN_PCT} to ${CUSTOM_CAP_MAX_PCT}`
              }
            />
            <TextField
              label="Drawdown halt %"
              value={halt}
              onChange={(event) => setHalt(event.target.value)}
              size="small"
              helperText={`${CUSTOM_CAP_MIN_PCT} to ${CUSTOM_CAP_MAX_PCT}`}
            />
          </Box>
          {kellyWarning ? (
            <Alert severity="warning" sx={{ mt: 2 }} role="status">
              Above {KELLY_WARNING_THRESHOLD}×, Kelly sizing is highly sensitive
              to probability error. Full Kelly assumes the probability is
              exactly right.
            </Alert>
          ) : null}
        </Paper>
      ) : null}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h2" sx={{ mb: 1.5 }}>
          Bankroll
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
            maxWidth: 620,
          }}
        >
          <TextField
            label="Starting bankroll $"
            value={startingDollars}
            onChange={(event) => setStartingDollars(event.target.value)}
            size="small"
            disabled={!config.startingBankrollEditable}
            helperText={
              config.startingBankrollEditable
                ? "Locked once the campaign has positions."
                : "Locked — the campaign has positions. Starting bankroll defines the historical record."
            }
          />
          <TextField
            label="Withdrawal ceiling ×"
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            size="small"
            helperText={`= ${formatCents(
              Math.round(Number(startingDollars) * 100 * Number(ceiling) || 0),
            )}`}
          />
        </Box>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", mt: 1.5, maxWidth: 640 }}
        >
          When active bankroll exceeds the ceiling, the excess is withdrawn to
          simulated withdrawn profit and active bankroll returns to the ceiling.
          This repeats each time the ceiling is exceeded.
        </Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>
          Autonomous execution
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={config.hasActiveHaltingBreach}
            />
          }
          label="Cycles run automatically before each game window"
        />
        {config.hasActiveHaltingBreach ? (
          <Typography variant="body2" sx={{ color: "warning.main" }}>
            A safety condition is active. Clear or override it on the overview
            before enabling autonomy.
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
          Cutoff: no new position inside 10 minutes of kickoff. Not
          configurable, and not relaxed by any risk mode.
        </Typography>
      </Paper>

      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "flex-end", alignItems: "center" }}
      >
        {invalid ? (
          <Typography variant="caption" sx={{ color: "error.main" }}>
            One field is invalid.
          </Typography>
        ) : null}
        <Button
          variant="text"
          onClick={() => router.refresh()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button variant="outlined" onClick={save} disabled={pending || invalid}>
          Save configuration
        </Button>
      </Stack>
    </Stack>
  );
}

function ModeCard({
  option,
  selected,
  onSelect,
  custom,
}: {
  option: Mode;
  selected: boolean;
  onSelect: () => void;
  custom: { kelly: string; gameCap: string; slateCap: string; halt: string };
}) {
  const preset = option === "custom" ? null : RISK_PRESETS[option];

  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        border: 1,
        borderRadius: 1,
        px: 2,
        py: 1.5,
        borderColor: selected ? "primary.main" : "divider",
        backgroundColor: selected ? "primary.soft" : "background.paper",
        color: "text.primary",
      }}
    >
      <Typography
        variant="label"
        sx={{ color: selected ? "primary.main" : "text.primary" }}
      >
        {option}
        {selected ? " ●" : ""}
      </Typography>
      <NumericText
        size="sm"
        sx={{ color: "text.secondary", display: "block", mt: 0.5 }}
      >
        {preset
          ? `${preset.kellyFraction.toFixed(2)}× Kelly · game ${preset.perGameCapPct}% · slate ${preset.perSlateCapPct}% · halt ${preset.drawdownHaltPct}%`
          : `${custom.kelly}× Kelly · game ${custom.gameCap}% · slate ${custom.slateCap}% · halt ${custom.halt}%`}
      </NumericText>
    </Box>
  );
}
