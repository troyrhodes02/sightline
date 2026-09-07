"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
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
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import {
  AutonomyHeading,
  Figure,
  formatCents,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import type { Review, ReviewPeriod, SafetyEvent } from "@/lib/paper/review";
import type { ReplayModeResult } from "@/lib/paper/replay";

export type ReplayView = {
  ranAt: string | null;
  actualMode: string;
  rows: ReplayModeResult[];
  available: boolean;
  blockedReason: string | null;
};

/**
 * Paper performance review, and beneath a hard rule, the counterfactual.
 *
 * The separation is structural rather than decorative. The replay reports what
 * a DIFFERENT risk mode would have done; it writes only its own tables, feeds
 * no figure above it, and changes no setting. Placing it inside the same
 * section as the actual result would invite exactly the mode-chasing the pitch
 * names as a rabbit hole.
 */
export function AutonomyReview({
  review,
  periods,
  replay,
}: {
  review: Review | null;
  periods: ReviewPeriod[];
  replay: ReplayView;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runReplay() {
    if (!review) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/autonomy/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodKind: review.period.kind,
          periodKey: review.period.key,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          body?.message ??
            "Replay could not complete. No stored replay was changed.",
        );
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Replay could not complete. No stored replay was changed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={3}>
      <AutonomyHeading title="Review" />
      <AutonomyTabs current="/autonomy/review" />

      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
        <GranularityLinks current={review?.period.kind ?? "week"} />
        {periods.length > 0 ? (
          <PeriodLinks periods={periods} current={review?.period.key ?? null} />
        ) : null}
      </Stack>

      {!review ? (
        <Paper>
          <EmptyState
            title="No completed period to review."
            detail="Review becomes available once a game window's cycles have run and its positions settle."
            action={{ label: "View cycles", href: "/autonomy/cycles" }}
          />
        </Paper>
      ) : (
        <>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {review.period.label}
            {review.modesUsed.length > 0
              ? ` · risk mode ${review.modesUsed.join(", ")}`
              : ""}
          </Typography>

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
            <Figure
              label="Starting bankroll"
              value={formatCents(review.startingBankrollCents)}
            />
            <Figure
              label="Ending active"
              value={formatCents(review.endingActiveBankrollCents)}
            />
            <Figure
              label="Net paper P&L"
              value={formatCents(review.netPaperPnlCents, true)}
              tone={
                review.netPaperPnlCents < 0
                  ? "negative"
                  : review.netPaperPnlCents > 0
                    ? "positive"
                    : "neutral"
              }
              sub="after fills and fees"
            />
            <Figure
              label="Simulated withdrawals"
              value={formatCents(review.cumulativeWithdrawalsCents)}
            />
          </Stack>

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
            <Figure
              label="Total paper wealth"
              value={formatCents(review.totalPaperWealthCents)}
            />
            <Figure
              label="Max drawdown"
              value={
                review.maxDrawdownBps === null
                  ? "unavailable"
                  : `${(review.maxDrawdownBps / 100).toFixed(1)}%`
              }
              sub="mark-to-market"
            />
            <Figure
              label="Positions"
              value={String(review.positionCount)}
              sub={`${review.settledCount} settled`}
            />
            <Figure
              label="Fill quality"
              value={`${review.fillQuality.complete} / ${review.fillQuality.partial} / ${review.fillQuality.unfilled}`}
              sub="complete / partial / unfilled"
            />
          </Stack>

          <Paper>
            <Typography variant="h2" sx={{ px: 2, py: 1.5 }}>
              Safety events
            </Typography>
            {review.safetyEvents.length === 0 ? (
              <Typography
                variant="body2"
                sx={{ px: 2, pb: 2, color: "text.secondary" }}
              >
                No breaker tripped in this period.
              </Typography>
            ) : (
              <Table size="small">
                <TableBody>
                  {review.safetyEvents.map((event) => (
                    <SafetyRow key={event.id} event={event} />
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>

          <Paper sx={{ px: 2, py: 1.5 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1,
              }}
            >
              <Typography variant="h2">Model quality this period</Typography>
              <Button
                size="small"
                variant="text"
                component={Link}
                href="/accuracy"
              >
                Accuracy →
              </Button>
            </Stack>
            <NumericText size="sm" sx={{ color: "text.secondary" }}>
              {review.modelQuality.rollingBrier === null
                ? "No graded predictions yet."
                : `Rolling Brier ${review.modelQuality.rollingBrier.toFixed(3)} over ${review.modelQuality.gradedObservations} graded contract-like predictions.` +
                  (review.modelQuality.backtestBrier !== null
                    ? ` Backtest reference ${review.modelQuality.backtestBrier.toFixed(3)}.`
                    : "") +
                  (review.modelQuality.marketBrier !== null
                    ? ` Market ${review.modelQuality.marketBrier.toFixed(3)} over the same contracts.`
                    : "")}
            </NumericText>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Paper P&amp;L is a financial result over {review.positionCount}{" "}
              positions. It is not evidence of model quality on its own.
            </Typography>
          </Paper>

          <Box
            sx={{
              borderTop: 3,
              borderStyle: "double",
              borderColor: "border.strong",
              pt: 2.5,
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1,
              }}
            >
              <Typography variant="h2">
                Counterfactual risk-mode replay
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={runReplay}
                disabled={pending || !replay.available}
              >
                {pending ? "Replaying…" : "Run replay"}
              </Button>
            </Stack>

            {pending ? <LinearProgress sx={{ mb: 1 }} /> : null}
            {error ? (
              <Alert severity="error" sx={{ mb: 1 }}>
                {error}
              </Alert>
            ) : null}

            {!replay.available && replay.blockedReason ? (
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", mb: 1 }}
              >
                {replay.blockedReason}
              </Typography>
            ) : null}

            <Typography
              variant="body2"
              sx={{ color: "text.secondary", mb: 1.5 }}
            >
              Replay uses the state available at each original decision time.
              Only the risk configuration changes; the projections, corrected
              probabilities, observed books, fill policy, and settlements are
              the ones that actually applied.
            </Typography>

            {replay.rows.length > 0 ? (
              <Paper sx={{ mb: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Mode</TableCell>
                      <TableCell align="right">Ending active</TableCell>
                      <TableCell align="right">Net P&amp;L</TableCell>
                      <TableCell align="right">Withdrawn</TableCell>
                      <TableCell align="right">Max DD</TableCell>
                      <TableCell align="right">Pos</TableCell>
                      <TableCell align="right">Breakers</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {/* Fixed conservative → moderate → aggressive order, never
                        sorted by profit. Sorting by outcome is the visual form
                        of mode-chasing. */}
                    {["conservative", "moderate", "aggressive"].map((mode) => {
                      const row = replay.rows.find((r) => r.mode === mode);
                      if (!row) return null;
                      const actual = replay.actualMode === mode;
                      return (
                        <TableRow key={mode}>
                          <TableCell>
                            {mode}
                            {actual ? (
                              <Box
                                component="span"
                                sx={{ color: "text.muted" }}
                              >
                                {" *"}
                              </Box>
                            ) : null}
                          </TableCell>
                          <TableCell align="right">
                            <NumericText size="sm">
                              {formatCents(row.endingActiveCents)}
                            </NumericText>
                          </TableCell>
                          <TableCell align="right">
                            <NumericText
                              size="sm"
                              sx={{
                                color:
                                  row.netPnlCents < 0
                                    ? "error.main"
                                    : row.netPnlCents > 0
                                      ? "primary.main"
                                      : "text.primary",
                              }}
                            >
                              {formatCents(row.netPnlCents, true)}
                            </NumericText>
                          </TableCell>
                          <TableCell align="right">
                            <NumericText size="sm">
                              {formatCents(row.withdrawnCents)}
                            </NumericText>
                          </TableCell>
                          <TableCell align="right">
                            <NumericText size="sm">
                              {(row.maxDrawdownBps / 100).toFixed(1)}%
                            </NumericText>
                          </TableCell>
                          <TableCell align="right">
                            <NumericText size="sm">
                              {row.positionCount}
                            </NumericText>
                          </TableCell>
                          <TableCell align="right">
                            <NumericText size="sm">
                              {row.breakerTrips}
                            </NumericText>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Paper>
            ) : null}

            {replay.ranAt ? (
              <Typography variant="caption" sx={{ color: "text.muted" }}>
                <Box component="span" sx={{ color: "text.muted" }}>
                  *
                </Box>{" "}
                the mode actually used. Replayed {formatTimestamp(replay.ranAt)}
                .
              </Typography>
            ) : null}

            <Typography
              variant="body2"
              sx={{ color: "text.secondary", mt: 1, maxWidth: 680 }}
            >
              Replays are decision support. Sightline does not change risk mode
              from a replay result; you do, in Configuration.
            </Typography>
          </Box>
        </>
      )}
    </Stack>
  );
}

function SafetyRow({ event }: { event: SafetyEvent }) {
  // A force override renders in warning tone PERMANENTLY, with actor and time.
  // It never ages into "cleared" — the record exists to keep the fact that the
  // bot wanted to stop and was deliberately overruled.
  const overridden = event.resolution === "force_overridden";

  return (
    <TableRow>
      <TableCell>
        <NumericText size="sm">{formatTimestamp(event.trippedAt)}</NumericText>
      </TableCell>
      <TableCell>{event.condition.replace(/_/g, " ")}</TableCell>
      <TableCell>
        <NumericText size="sm">
          measured {event.measuredDisplay}, threshold {event.thresholdDisplay}
        </NumericText>
      </TableCell>
      <TableCell
        sx={{
          color: overridden
            ? "warning.main"
            : event.resolution === "active"
              ? "error.main"
              : "text.secondary",
        }}
      >
        {overridden
          ? `force overridden${event.resolvedByDisplayName ? ` by ${event.resolvedByDisplayName}` : ""}${event.resolvedAt ? `, ${formatTimestamp(event.resolvedAt)}` : ""}`
          : event.resolution === "active"
            ? "still active"
            : `cleared${event.resolvedAt ? ` ${formatTimestamp(event.resolvedAt)}` : ""}`}
      </TableCell>
    </TableRow>
  );
}

function GranularityLinks({ current }: { current: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {(["game_window", "week", "campaign"] as const).map((kind) => (
        <Box
          key={kind}
          component={Link}
          href={`/autonomy/review?granularity=${kind}`}
          sx={{
            px: 1,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 0.5,
            border: 1,
            fontSize: 12,
            fontWeight: 500,
            textDecoration: "none",
            borderColor: kind === current ? "primary.main" : "border.strong",
            color: kind === current ? "primary.main" : "text.secondary",
          }}
        >
          {kind.replace("_", " ")}
        </Box>
      ))}
    </Stack>
  );
}

function PeriodLinks({
  periods,
  current,
}: {
  periods: ReviewPeriod[];
  current: string | null;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      {periods.slice(0, 8).map((period) => (
        <Box
          key={period.key}
          component={Link}
          href={`/autonomy/review?granularity=${period.kind}&period=${encodeURIComponent(period.key)}`}
          sx={{
            px: 1,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 0.5,
            border: 1,
            fontSize: 12,
            fontWeight: 500,
            textDecoration: "none",
            borderColor:
              period.key === current ? "primary.main" : "border.strong",
            color: period.key === current ? "primary.main" : "text.secondary",
          }}
        >
          {period.label}
        </Box>
      ))}
    </Stack>
  );
}
