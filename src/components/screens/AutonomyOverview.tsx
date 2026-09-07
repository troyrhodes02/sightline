import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { KillSwitchButton } from "@/components/autonomy/KillSwitchButton";
import { BankrollChart } from "@/components/autonomy/BankrollChart";
import {
  AutonomyHeading,
  ExposureMeter,
  Figure,
  RiskModeChip,
  formatCents,
  formatKickoff,
  formatMoney,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import type { AutonomyOverviewDto, CycleRowDto } from "@/lib/dto/autonomy";
import { isMoneyAvailable } from "@/lib/dto/autonomy";

/**
 * The Sunday-morning screen.
 *
 * Ordered by what has to be true before anything else matters: the safety
 * state, then the bankroll decomposed rather than summarised, then exposure
 * against its caps, then what the bot actually did.
 *
 * `unavailable` is a rendered value throughout. When mark-to-market cannot be
 * computed the active bankroll, total wealth, net P&L and drawdown all say so
 * — none of them falls back to a settled-only figure, because a drawdown on a
 * different basis than the breaker's would misstate the safety state.
 */
export function AutonomyOverview({
  overview,
}: {
  overview: AutonomyOverviewDto | null;
}) {
  if (!overview) {
    return (
      <Stack spacing={3}>
        <AutonomyHeading title="Autonomy" />
        <AutonomyTabs current="/autonomy" />
        <Paper>
          <EmptyState
            title="Autonomous paper trading is not set up."
            detail="Configure a starting bankroll and a risk mode, then run a Dry Run against an upcoming game window before enabling anything."
            action={{ label: "Configuration", href: "/autonomy/configuration" }}
          />
        </Paper>
      </Stack>
    );
  }

  const { figures, mode } = overview;
  const halting = overview.breaches.filter((breach) => breach.halts);
  const warnings = overview.breaches.filter((breach) => !breach.halts);
  const haltThresholdCents =
    mode !== null
      ? Math.round(
          figures.highWaterMarkCents * (1 - mode.drawdownHaltPct / 100),
        )
      : null;

  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Autonomy"
        action={<KillSwitchButton engaged={overview.killSwitchEngaged} />}
      />
      <AutonomyTabs current="/autonomy" />

      {overview.breaches.length > 0 ? (
        <Alert
          severity={halting.length > 0 ? "error" : "warning"}
          role="alert"
          action={
            halting.length > 0 ? (
              <Stack direction="row" spacing={1}>
                {/* Resume is disabled while anything is still breached; Force
                    Override is a separate route, never a sibling dialog. */}
                <Button size="small" variant="outlined" disabled>
                  Resume
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  component={Link}
                  href="/autonomy/override"
                  sx={{ color: "warning.main", borderColor: "warning.main" }}
                >
                  Force override →
                </Button>
              </Stack>
            ) : undefined
          }
        >
          <AlertTitle>
            {overview.status === "killed"
              ? "Killed"
              : halting.length > 0
                ? "Halted"
                : "Warning"}
          </AlertTitle>
          <Stack spacing={0.5}>
            {[...halting, ...warnings].map((breach) => (
              <Typography key={breach.id} variant="body2">
                {breach.label} — measured {breach.measuredDisplay}, threshold{" "}
                {breach.thresholdDisplay}
              </Typography>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {!figures.markToMarketAvailable ? (
        <Alert severity="info">
          Kalshi prices unavailable for at least one open position.
          Mark-to-market, and therefore drawdown, cannot be computed. Cost,
          result, and realised P&amp;L are unaffected.
          {figures.priceLastFetchedAt
            ? ` Last successful fetch ${formatTimestamp(figures.priceLastFetchedAt)}.`
            : null}
        </Alert>
      ) : null}

      {overview.emptyReason === "not_enabled" ? (
        <Paper>
          <EmptyState
            title="Autonomous paper trading is not enabled."
            detail={`Starting bankroll ${formatCents(figures.startingBankrollCents)} · risk mode ${mode?.mode ?? "unset"}. Run a Dry Run against an upcoming game window to see what the bot would do before it does anything.`}
            action={{ label: "Open Dry Run", href: "/autonomy/dry-run" }}
          />
        </Paper>
      ) : (
        <>
          <Stack
            direction={{ xs: "row", md: "row" }}
            spacing={1.5}
            sx={{ flexWrap: { xs: "wrap", md: "nowrap" } }}
          >
            <Figure
              label="Active bankroll"
              value={formatMoney(figures.activeBankroll)}
              sub={`settled ${formatCents(figures.settledBalanceCents)} + open ${formatCents(figures.openExposureCents)}`}
            />
            <Figure
              label="Total paper wealth"
              value={formatMoney(figures.totalPaperWealth)}
              sub={`withdrawn ${formatCents(figures.cumulativeWithdrawalsCents)}`}
            />
            <Figure
              label="Net paper P&L"
              value={formatMoney(figures.netPaperPnl, true)}
              tone={
                isMoneyAvailable(figures.netPaperPnl)
                  ? figures.netPaperPnl.cents < 0
                    ? "negative"
                    : figures.netPaperPnl.cents > 0
                      ? "positive"
                      : "neutral"
                  : "neutral"
              }
              sub={`of starting ${formatCents(figures.startingBankrollCents)}`}
            />
            <Figure
              label="Drawdown"
              value={
                figures.maxDrawdownBps === null
                  ? "unavailable"
                  : `${(figures.maxDrawdownBps / 100).toFixed(1)}%`
              }
              sub={`mark-to-market · peak ${formatCents(figures.highWaterMarkCents)}`}
            />
          </Stack>

          {mode ? (
            <Paper sx={{ px: 2, py: 1.5 }}>
              <Stack spacing={1}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{
                    alignItems: { sm: "center" },
                    justifyContent: "space-between",
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography
                      variant="label"
                      sx={{ color: "text.secondary" }}
                    >
                      Risk mode
                    </Typography>
                    <RiskModeChip mode={mode} />
                    <NumericText size="sm" sx={{ color: "text.secondary" }}>
                      {mode.kellyFraction.toFixed(2)}× Kelly · game{" "}
                      {mode.perGameCapPct}% · slate {mode.perSlateCapPct}% ·
                      halt {mode.drawdownHaltPct}%
                    </NumericText>
                  </Stack>
                  <Button
                    size="small"
                    variant="text"
                    component={Link}
                    href="/autonomy/configuration"
                  >
                    Configure →
                  </Button>
                </Stack>
                <Typography variant="body2">
                  Corrected probability ceiling{" "}
                  {mode.probabilityCeiling.toFixed(3)} — independent of risk
                  mode.
                </Typography>
              </Stack>
            </Paper>
          ) : null}

          {overview.exposure.slate ? (
            <Paper sx={{ px: 2, py: 1.5 }}>
              <Typography variant="h2" sx={{ mb: 0.5 }}>
                Open exposure
              </Typography>
              <ExposureMeter meter={overview.exposure.slate} />
              {overview.exposure.games.map((game) => (
                <ExposureMeter key={game.key} meter={game} />
              ))}
            </Paper>
          ) : null}

          <Paper sx={{ px: 2, py: 1.5 }}>
            <Typography variant="h2" sx={{ mb: 1 }}>
              Bankroll history
            </Typography>
            <BankrollChart
              series={overview.history}
              highWaterMarkCents={figures.highWaterMarkCents}
              haltThresholdCents={haltThresholdCents}
            />
          </Paper>

          <Paper>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                px: 2,
                py: 1.5,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="h2">Recent cycles</Typography>
              <Button
                size="small"
                variant="text"
                component={Link}
                href="/autonomy/cycles"
              >
                All cycles →
              </Button>
            </Stack>
            {overview.recentCycles.length === 0 ? (
              <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {overview.emptyReason === "offseason"
                    ? `Offseason. Autonomous cycles resume with the season schedule.${overview.lastCycleAt ? ` Last cycle ${formatTimestamp(overview.lastCycleAt)}.` : ""}`
                    : overview.nextWindowOpensAt
                      ? `No cycles yet this week. The next window opens ${formatTimestamp(overview.nextWindowOpensAt)}.`
                      : "No cycles recorded."}
                </Typography>
              </Box>
            ) : (
              <Stack
                divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
              >
                {overview.recentCycles.map((cycle) => (
                  <CycleLine key={cycle.cycleId} cycle={cycle} />
                ))}
              </Stack>
            )}
          </Paper>

          <Paper sx={{ px: 2, py: 1.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              sx={{
                alignItems: { sm: "center" },
                justifyContent: "space-between",
              }}
            >
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography variant="h2">Live readiness</Typography>
                <ReadinessChip state={overview.readiness.state} />
                <NumericText size="sm" sx={{ color: "text.secondary" }}>
                  {overview.readiness.weeksComplete} of{" "}
                  {overview.readiness.weeksRequired} NFL weeks
                </NumericText>
              </Stack>
              <Button
                size="small"
                variant="text"
                component={Link}
                href="/autonomy/readiness"
              >
                View evidence →
              </Button>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
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

function CycleLine({ cycle }: { cycle: CycleRowDto }) {
  return (
    <Box
      component={Link}
      href={`/autonomy/cycles/${cycle.cycleId}`}
      sx={{
        px: 2,
        py: 1.25,
        display: "flex",
        gap: 2,
        justifyContent: "space-between",
        textDecoration: "none",
        color: "inherit",
        "&:hover": { backgroundColor: "action.hover" },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1">
          {cycle.gameLabel} · {formatKickoff(cycle.kickoffAt)}
        </Typography>
        <NumericText size="sm" sx={{ color: "text.secondary" }}>
          {cycle.candidatesEvaluated === null
            ? formatTimestamp(cycle.startedAt)
            : `${cycle.candidatesEvaluated} candidates · ${cycle.candidatesFilled} filled${
                cycle.stakedCents !== null
                  ? ` · ${formatCents(cycle.stakedCents)}`
                  : ""
              }`}
        </NumericText>
        {cycle.reason ? (
          <NumericText
            size="sm"
            sx={{ color: "text.secondary", display: "block" }}
          >
            {cycle.reason}
          </NumericText>
        ) : null}
      </Box>
      <Typography
        variant="body2"
        sx={{ color: OUTCOME_TONE[cycle.outcome], flexShrink: 0 }}
      >
        {OUTCOME_COPY[cycle.outcome]}
      </Typography>
    </Box>
  );
}

export function ReadinessChip({
  state,
}: {
  state: AutonomyOverviewDto["readiness"]["state"];
}) {
  // Outlined in every state, never filled, and never adjacent to a control.
  // Eligibility is a report, not a call to action.
  const copy = {
    not_ready: "not ready",
    paper_evidence_building: "paper evidence building",
    eligible_for_live_trading: "eligible for live trading",
  }[state];
  const tone = {
    not_ready: "text.secondary",
    paper_evidence_building: "warning.main",
    eligible_for_live_trading: "primary.main",
  }[state];

  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        px: 1,
        borderRadius: 0.5,
        border: 1,
        borderColor: tone === "text.secondary" ? "border.strong" : tone,
        color: tone,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {copy}
    </Box>
  );
}
