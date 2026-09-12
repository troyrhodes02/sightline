"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { BankrollChart } from "@/components/autonomy/BankrollChart";
import { BotControls } from "@/components/autonomy/BotControls";
import { BotEngineChip, BotRiskModeChip } from "@/components/autonomy/BotChips";
import {
  Figure,
  PaperModeSubtitle,
  formatCents,
  formatKickoff,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import type { CycleRowDto, PositionRowDto } from "@/lib/dto/autonomy";
import type { PaperBotDetailDto } from "@/lib/dto/paper-bots";

/**
 * Paper Bot → one bot's detail (design doc §9).
 *
 * A quiet, glanceable readout: the bankroll-over-time graph (the same themed
 * chart the overview uses), a summary of the money figures, the contracts the
 * bot took, and its recent cycles. Every block carries its own empty state — a
 * bot that has done nothing yet is a legitimate, well-formed screen, not an
 * error. Rename and pause/resume live in the header controls.
 */
export function PaperBotDetail({ detail }: { detail: PaperBotDetailDto }) {
  const { summary } = detail;

  const netTone =
    summary.netPnlCents === null
      ? "neutral"
      : summary.netPnlCents > 0
        ? "positive"
        : summary.netPnlCents < 0
          ? "negative"
          : "neutral";

  return (
    <Stack spacing={3}>
      <Box>
        <Typography
          component={Link}
          href="/autonomy/bots"
          variant="body2"
          sx={{ color: "primary.main", textDecoration: "none" }}
        >
          ← Bots
        </Typography>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "stretch", sm: "flex-start" },
        }}
      >
        <Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="h1">{summary.name}</Typography>
            <BotEngineChip engine={summary.engine} />
            <BotRiskModeChip mode={summary.riskMode} />
            {summary.isComparison ? (
              <Typography variant="caption" sx={{ color: "text.muted" }}>
                comparison bot
              </Typography>
            ) : null}
            {!summary.autonomyEnabled ? (
              <Typography variant="caption" sx={{ color: "warning.main" }}>
                paused
              </Typography>
            ) : null}
          </Stack>
          <PaperModeSubtitle />
        </Box>
        <BotControls
          botId={summary.id}
          name={summary.name}
          autonomyEnabled={summary.autonomyEnabled}
        />
      </Stack>

      <Paper sx={{ px: 2, py: 2 }}>
        <Typography variant="h2" sx={{ mb: 1.5 }}>
          Bankroll
        </Typography>
        <BankrollChart
          series={detail.bankrollHistory.map((point) => ({
            at: point.at,
            settledCents: point.settledCents,
          }))}
          highWaterMarkCents={detail.highWaterMarkCents}
          haltThresholdCents={null}
        />
      </Paper>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, 1fr)",
            sm: "repeat(3, 1fr)",
            md: "repeat(6, 1fr)",
          },
          gap: 1.5,
        }}
      >
        <Figure
          label="Starting"
          value={formatCents(summary.startingBankrollCents)}
        />
        <Figure
          label="Current"
          value={
            summary.activeBankrollCents === null
              ? "unavailable"
              : formatCents(summary.activeBankrollCents)
          }
        />
        <Figure
          label="Net P&L"
          value={
            summary.netPnlCents === null
              ? "—"
              : formatCents(summary.netPnlCents, true)
          }
          tone={netTone}
        />
        <Figure
          label="Return"
          value={
            summary.returnPct === null
              ? "—"
              : `${summary.returnPct >= 0 ? "+" : "−"}${Math.abs(summary.returnPct).toFixed(1)}%`
          }
          tone={netTone}
        />
        <Figure
          label="Max drawdown"
          value={
            summary.maxDrawdownBps === null
              ? "—"
              : `${(summary.maxDrawdownBps / 100).toFixed(1)}%`
          }
        />
        <Figure label="Withdrawn" value={formatCents(detail.withdrawnCents)} />
      </Box>

      <Paper>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h2">Positions</Typography>
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            {detail.openPositionCount} open · {detail.settledPositionCount}{" "}
            settled
          </Typography>
        </Stack>
        {detail.positions.length === 0 ? (
          <EmptyState
            title="No positions yet."
            detail="Positions appear once a scheduled cycle fills one for this bot."
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contract</TableCell>
                <TableCell>Side</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell align="right">Mark</TableCell>
                <TableCell>Result</TableCell>
                <TableCell align="right">P&amp;L</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {detail.positions.map((row) => (
                <PositionRow key={row.positionId} row={row} />
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Paper>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="h2">Recent cycles</Typography>
        </Box>
        {detail.recentCycles.length === 0 ? (
          <EmptyState
            title="No cycles yet."
            detail="Cycles begin once a game window opens while the bot is enabled. A skipped or failed cycle is a row with a reason, never an absence."
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Started</TableCell>
                <TableCell>Game window</TableCell>
                <TableCell align="right">Cand.</TableCell>
                <TableCell align="right">Sized</TableCell>
                <TableCell align="right">Filled</TableCell>
                <TableCell align="right">Staked</TableCell>
                <TableCell>Outcome</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {detail.recentCycles.map((row) => (
                <CycleRow key={row.cycleId} row={row} />
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}

function PositionRow({ row }: { row: PositionRowDto }) {
  const voided = row.status === "voided";
  const partial = row.unfilledStakeCents > 0;

  return (
    <TableRow sx={voided ? { color: "text.secondary" } : undefined}>
      <TableCell>
        <Typography
          variant="body2"
          sx={voided ? { color: "text.secondary" } : undefined}
        >
          {row.playerName}
          {row.statType && row.threshold !== null
            ? ` · ${row.statType.replace(/_/g, " ")} ≥ ${row.threshold}`
            : ""}
        </Typography>
        <NumericText
          size="sm"
          sx={{ color: "text.secondary", display: "block" }}
        >
          opened {formatTimestamp(row.openedAt)}
          {row.settledAt ? ` · settled ${formatTimestamp(row.settledAt)}` : ""}
          {" · intended "}
          {formatCents(row.intendedStakeCents)}
          {partial ? "" : " · filled complete"}
        </NumericText>
        {partial ? (
          <NumericText
            size="sm"
            sx={{ color: "warning.main", display: "block" }}
          >
            partial — {formatCents(row.unfilledStakeCents)} unfilled
          </NumericText>
        ) : null}
      </TableCell>
      <TableCell sx={{ color: voided ? "text.secondary" : "market.main" }}>
        {row.side}
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm">{row.contracts}</NumericText>
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm">
          {formatCents(row.costBasisCents + row.feesPaidCents)}
        </NumericText>
      </TableCell>
      <TableCell align="right">
        {row.status !== "open" ? (
          <NumericText size="sm" muted>
            —
          </NumericText>
        ) : row.markCents === null ? (
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            unavailable
          </Typography>
        ) : (
          <NumericText size="sm" sx={{ color: "market.main" }}>
            {formatCents(row.markCents)}
          </NumericText>
        )}
      </TableCell>
      <TableCell>
        {row.status === "open" ? (
          <Typography variant="body2">open</Typography>
        ) : voided ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            voided
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ color: "market.main" }}>
            settled {row.settlementResult}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        {row.realizedPnlCents === null ? (
          <NumericText size="sm" muted>
            —
          </NumericText>
        ) : (
          <NumericText
            size="sm"
            sx={{
              color:
                row.realizedPnlCents > 0
                  ? "primary.main"
                  : row.realizedPnlCents < 0
                    ? "error.main"
                    : "text.primary",
            }}
          >
            {formatCents(row.realizedPnlCents, true)}
          </NumericText>
        )}
      </TableCell>
    </TableRow>
  );
}

const OUTCOME_TONE: Record<CycleRowDto["outcome"], string> = {
  ok: "text.primary",
  no_candidate: "text.primary",
  partial_fill: "warning.main",
  skipped: "warning.main",
  halted: "error.main",
  failed: "error.main",
};

const OUTCOME_COPY: Record<CycleRowDto["outcome"], string> = {
  ok: "ok",
  no_candidate: "no candidate",
  partial_fill: "partial fill",
  skipped: "skipped",
  halted: "halted",
  failed: "failed",
};

function CycleRow({ row }: { row: CycleRowDto }) {
  return (
    <TableRow>
      <TableCell>
        <NumericText size="sm">{formatTimestamp(row.startedAt)}</NumericText>
      </TableCell>
      <TableCell>
        {row.gameLabel} · {formatKickoff(row.kickoffAt)}
        {row.reason ? (
          <NumericText
            size="sm"
            sx={{ color: "text.secondary", display: "block" }}
          >
            {row.reason}
          </NumericText>
        ) : null}
      </TableCell>
      <Count value={row.candidatesEvaluated} />
      <Count value={row.candidatesSized} />
      <Count value={row.candidatesFilled} />
      <TableCell align="right">
        <NumericText size="sm" muted={row.stakedCents === null}>
          {row.stakedCents === null ? "—" : formatCents(row.stakedCents)}
        </NumericText>
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ color: OUTCOME_TONE[row.outcome] }}>
          {OUTCOME_COPY[row.outcome]}
        </Typography>
      </TableCell>
    </TableRow>
  );
}

function Count({ value }: { value: number | null }) {
  return (
    <TableCell align="right">
      <NumericText size="sm" muted={value === null}>
        {value === null ? "—" : value}
      </NumericText>
    </TableCell>
  );
}
