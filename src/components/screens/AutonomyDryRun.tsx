"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import {
  AutonomyHeading,
  formatCents,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import { CandidateCard } from "./AutonomyCycles";
import type { CandidateDto } from "@/lib/dto/autonomy";

export type DryRunWindow = {
  gameId: string;
  label: string;
  kickoffAt: string;
};

type DryRunResponse = {
  gameLabel: string;
  ranAt: string;
  wouldExecute: boolean;
  blockedByBreaches: string[];
  slateCapacityCents: number;
  plan: {
    outcome: string;
    skipReason: string | null;
    candidates: CandidateDto[];
    allocationTrace: string[];
    stakedCents: number;
  };
};

/**
 * Dry Run.
 *
 * The same decision path, rendered, writing nothing. It shares `CandidateCard`
 * verbatim with cycle detail — only the verb tense differs — because a Dry Run
 * that approximated what a cycle would do would defeat its own purpose the
 * first time the two drifted, and the drift would be invisible.
 *
 * A blocking breaker is reported explicitly rather than shown as an empty
 * candidate list: "nothing would happen" and "nothing would happen because the
 * bot is halted" are different answers, and only one of them is about the
 * slate.
 */
export function AutonomyDryRun({ windows }: { windows: DryRunWindow[] }) {
  const [gameId, setGameId] = useState(windows[0]?.gameId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DryRunResponse | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/autonomy/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          (body as { message?: string }).message ??
            "Dry run could not complete. Nothing was written.",
        );
      }
      setResult(body as DryRunResponse);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Dry run could not complete. Nothing was written.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Dry Run"
        detail="Paper mode · all figures simulated · this run writes nothing"
      />
      <AutonomyTabs current="/autonomy/dry-run" />

      <Paper sx={{ px: 2, py: 1.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { sm: "center" }, mb: 1 }}
        >
          <TextField
            select
            size="small"
            label="Game window"
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            disabled={windows.length === 0}
            sx={{ minWidth: 320 }}
          >
            {windows.map((window) => (
              <MenuItem key={window.gameId} value={window.gameId}>
                {window.label} · {formatTimestamp(window.kickoffAt)}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            onClick={run}
            disabled={pending || windows.length === 0}
          >
            {pending ? "Running…" : "Run dry run"}
          </Button>
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Uses the active risk mode, the active recalibration, the current
          bankroll state, the same exposure caps, the same breaker evaluation,
          and the same fill policy as an autonomous cycle. Creates no position
          and changes no bankroll.
        </Typography>
      </Paper>

      {windows.length === 0 ? (
        <Paper>
          <EmptyState
            title="No upcoming game window has resolvable contracts."
            detail="Dry Run becomes available once the slate has contracts for a scheduled game."
          />
        </Paper>
      ) : null}

      {pending ? <LinearProgress /> : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {result ? (
        <>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Result · {result.gameLabel} · run {formatTimestamp(result.ranAt)} ·{" "}
            {result.wouldExecute
              ? "would have executed"
              : "would not have executed"}
          </Typography>

          {result.blockedByBreaches.length > 0 ? (
            <Alert severity="warning">
              A breaker would block this cycle:{" "}
              {result.blockedByBreaches.join(", ")}. The candidates below are
              what the cycle would have evaluated before the block.
            </Alert>
          ) : null}

          <Paper>
            {result.plan.candidates.length === 0 ? (
              <EmptyState
                title="No resolvable contracts in this window."
                detail="A window with nothing to evaluate is a completed dry run, not a failure."
              />
            ) : (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {result.plan.candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.contractId}
                    candidate={candidate}
                    tense="conditional"
                  />
                ))}
              </Stack>
            )}
          </Paper>

          <NumericText size="sm" sx={{ color: "text.secondary" }}>
            Would have staked {formatCents(result.plan.stakedCents)} of{" "}
            {formatCents(result.slateCapacityCents)} slate capacity across{" "}
            {result.plan.candidates.filter((c) => c.filledContracts > 0).length}{" "}
            positions.
          </NumericText>

          {result.plan.allocationTrace.length > 0 ? (
            <Paper sx={{ px: 2, py: 1.5 }}>
              <Typography variant="h2" sx={{ mb: 1 }}>
                Reallocation
              </Typography>
              <Stack spacing={0.5}>
                {result.plan.allocationTrace.map((line, index) => (
                  <Typography
                    key={index}
                    variant="body2"
                    sx={{ color: "text.secondary" }}
                  >
                    {line}
                  </Typography>
                ))}
              </Stack>
            </Paper>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
