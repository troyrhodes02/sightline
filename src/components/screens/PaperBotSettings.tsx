"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { NumericText } from "@/components/primitives/NumericText";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import { AutonomyHeading, formatCents } from "@/components/autonomy/primitives";
import type {
  ModelSelectionRowDto,
  PaperBotSettingsDto,
} from "@/lib/dto/autonomy";
import {
  CUSTOM_CAP_MAX_PCT,
  CUSTOM_CAP_MIN_PCT,
  CUSTOM_KELLY_MAX,
  KELLY_WARNING_THRESHOLD,
  PROBABILITY_CEILING,
  RISK_PRESETS,
} from "@/lib/paper/config";

type Mode = "conservative" | "moderate" | "aggressive" | "custom";

const MODEL_LABEL: Record<string, string> = {
  "simulation-mc-0.1.0": "Simulation",
  "baseline-zil-0.1.0": "Baseline",
};

const STAT_LABEL: Record<string, string> = {
  passing_yards: "Passing yards",
  rushing_yards: "Rushing yards",
  receiving_yards: "Receiving yards",
  receptions: "Receptions",
  rushing_tds: "Rushing TDs",
  receiving_tds: "Receiving TDs",
};

/**
 * Paper Bot → Settings (PME-6, D13).
 *
 * The one place production configuration changes, and only on an explicit,
 * confirmed human save. Two independent forms: the per-stat model selection
 * (the sole production-config mutation, D12/D13) and the paper campaign config
 * (risk, bankroll, withdrawal, continuous evaluation — the former Configuration).
 *
 * Sightline's recommendation renders as an advisory ★ beside each stat row; there
 * is no "apply recommendation" control anywhere (D12). The radios reflect the
 * stored selection until William saves a change, and saving a selection opens a
 * confirmation Dialog restating the outgoing/incoming model and the readiness
 * clock reset (D2).
 */
export function PaperBotSettings({
  settings,
}: {
  settings: PaperBotSettingsDto;
}) {
  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Paper Bot"
        detail="Paper mode · all settings apply to simulated trading only"
      />
      <AutonomyTabs current="/autonomy/settings" />

      <ModelSelectionTable settings={settings} />
      <CampaignConfigForm settings={settings} />
    </Stack>
  );
}

function ModelSelectionTable({ settings }: { settings: PaperBotSettingsDto }) {
  const router = useRouter();
  const { baselineModelVersion, simulationModelVersion } = settings;

  // A draft of the selection radios; the stored value until saved.
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(
      settings.modelSelections.map((row) => [
        row.statType,
        row.activeModelVersion,
      ]),
    ),
  );
  const [confirming, setConfirming] = useState<ModelSelectionRowDto | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const changedRows = settings.modelSelections.filter(
    (row) => draft[row.statType] !== row.activeModelVersion,
  );

  function requestSave() {
    // One confirmation per changed stat is heavy; the design confirms the change
    // set. We confirm the first changed row and, on confirm, save every change.
    if (changedRows.length === 0) return;
    setConfirming(changedRows[0]);
  }

  async function confirmSave() {
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      for (const row of changedRows) {
        const response = await fetch("/api/model-selection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statType: row.statType,
            modelVersion: draft[row.statType],
            confirmed: true,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message ?? "The selection could not be saved.");
        }
      }
      setSaved(
        `Saved ${changedRows.length} selection${changedRows.length === 1 ? "" : "s"}. The readiness clock reset against the newly active configuration.`,
      );
      setConfirming(null);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The selection could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Active model by stat type
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        Sightline recommends a selection. It never applies one — you do.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          {saved}
        </Alert>
      ) : null}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Stat type</TableCell>
            <TableCell>Baseline</TableCell>
            <TableCell>Simulation</TableCell>
            <TableCell>Evidence</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {settings.modelSelections.map((row) => {
            const value = draft[row.statType];
            return (
              <TableRow key={row.statType}>
                <TableCell>
                  {STAT_LABEL[row.statType] ?? row.statType}
                </TableCell>
                <TableCell>
                  <FormControlLabel
                    control={
                      <Radio
                        size="small"
                        checked={value === baselineModelVersion}
                        onChange={() =>
                          setDraft((d) => ({
                            ...d,
                            [row.statType]: baselineModelVersion,
                          }))
                        }
                      />
                    }
                    label={
                      row.recommendedModelVersion === baselineModelVersion
                        ? "★"
                        : ""
                    }
                  />
                </TableCell>
                <TableCell>
                  {row.simulationSupported ? (
                    <FormControlLabel
                      control={
                        <Radio
                          size="small"
                          checked={value === simulationModelVersion}
                          onChange={() =>
                            setDraft((d) => ({
                              ...d,
                              [row.statType]: simulationModelVersion,
                            }))
                          }
                        />
                      }
                      label={
                        row.recommendedModelVersion === simulationModelVersion
                          ? "★"
                          : ""
                      }
                    />
                  ) : (
                    <Typography variant="caption" sx={{ color: "text.muted" }}>
                      Sim n/a
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {row.evidenceLabel}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Typography
        variant="caption"
        sx={{ color: "text.muted", display: "block", mt: 1 }}
      >
        ★ = Sightline&apos;s current recommendation (advisory only). Changing a
        stat type changes only that stat type. Switching a stat&apos;s model
        resets the readiness clock against the newly active configuration.
      </Typography>

      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "flex-end", mt: 1.5 }}
      >
        <Button
          variant="text"
          onClick={() =>
            setDraft(
              Object.fromEntries(
                settings.modelSelections.map((row) => [
                  row.statType,
                  row.activeModelVersion,
                ]),
              ),
            )
          }
          disabled={changedRows.length === 0 || pending}
        >
          Cancel
        </Button>
        <Button
          variant="outlined"
          onClick={requestSave}
          disabled={changedRows.length === 0 || pending}
        >
          Save selection
        </Button>
      </Stack>

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)}>
        <DialogTitle>Confirm model selection</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {changedRows.map((row) => (
              <Typography key={row.statType} variant="body2" sx={{ mb: 0.5 }}>
                {STAT_LABEL[row.statType] ?? row.statType}:{" "}
                {MODEL_LABEL[row.activeModelVersion] ?? row.activeModelVersion}{" "}
                → {MODEL_LABEL[draft[row.statType]] ?? draft[row.statType]}
              </Typography>
            ))}
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              This changes production for the stat type
              {changedRows.length === 1 ? "" : "s"} above. It resets the
              readiness clock against the newly active configuration&apos;s own
              paper portfolio.
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirmSave} variant="contained" disabled={pending}>
            {pending ? "Saving…" : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function CampaignConfigForm({ settings }: { settings: PaperBotSettingsDto }) {
  const router = useRouter();
  const config = settings.config;
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
    String(config.withdrawalCeilingMultiple),
  );
  const [enabled, setEnabled] = useState(config.autonomyEnabled);
  const [continuous, setContinuous] = useState(
    config.continuousEvaluationEnabled,
  );
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
          continuousEvaluationEnabled: continuous,
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
    <>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? (
        <Alert severity="success">
          Configuration saved. Applies to the next sizing decision; open
          positions keep the limits they were created under.
        </Alert>
      ) : null}

      <Paper sx={{ p: 2 }}>
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
          The probability ceiling ({PROBABILITY_CEILING.toFixed(3)}) does not
          change with mode.
        </Typography>

        {mode === "custom" ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "1fr 1fr",
                lg: "repeat(4, 1fr)",
              },
              gap: 2,
              mt: 2,
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
              helperText={`${CUSTOM_CAP_MIN_PCT} to ${CUSTOM_CAP_MAX_PCT}`}
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
        ) : null}
        {kellyWarning ? (
          <Alert severity="warning" sx={{ mt: 2 }} role="status">
            Above {KELLY_WARNING_THRESHOLD}×, Kelly sizing is highly sensitive
            to probability error.
          </Alert>
        ) : null}
      </Paper>

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
                ? "Locked once the first position fills."
                : "Locked — the campaign has positions."
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
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 1.5 }}>
          Applies identically to Baseline, Simulation, and Hybrid portfolios.
        </Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>
          Continuous paper evaluation
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={continuous}
              onChange={(event) => setContinuous(event.target.checked)}
            />
          }
          label="Enabled — cycles run automatically for eligible game windows"
        />
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
          Both engines run every eligible window; the non-active engine runs in
          shadow. No Dry Run is required.
        </Typography>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={
            <Switch
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={config.hasActiveHaltingBreach}
            />
          }
          label="Autonomous execution — cycles create positions"
        />
        {config.hasActiveHaltingBreach ? (
          <Typography variant="body2" sx={{ color: "warning.main" }}>
            A safety condition is active. Clear or override it on Performance
            before enabling autonomy.
          </Typography>
        ) : null}
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
    </>
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
