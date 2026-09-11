"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { KillSwitchButton } from "@/components/autonomy/KillSwitchButton";
import { MultiBankrollChart } from "@/components/autonomy/BankrollChart";
import { AutonomyHeading } from "@/components/autonomy/primitives";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import { PortfolioScorecard } from "@/components/model-performance/PortfolioScorecard";
import type { PaperBotPerformanceDto } from "@/lib/dto/autonomy";

/**
 * Paper Bot → Performance (PME-6, D10/D11/D19/D21).
 *
 * The landing surface: how the three paper portfolios compare financially under
 * identical assumptions, which leads, what the drawdowns were, and how close the
 * system is to real-money readiness — folding in the old Overview, Review, and
 * Readiness without their sprawl.
 *
 * Nothing here writes model selection or risk configuration; readiness never
 * enables live trading (D12, D21). Kill is campaign-wide; Resume and Force
 * Override are scoped to the halted portfolio. Money is neutral, only the sign
 * of a P&L figure takes colour (D19).
 */

const PORTFOLIO_LABEL: Record<string, string> = {
  baseline: "Baseline",
  simulation: "Simulation",
  hybrid: "Hybrid",
};

const PERIODS: Array<{ value: string; label: string }> = [
  { value: "campaign", label: "Campaign" },
  { value: "current_week", label: "Current week" },
  { value: "previous_week", label: "Previous week" },
  { value: "two_week", label: "Required two-week" },
];

export function PaperBotPerformance({
  data,
}: {
  data: PaperBotPerformanceDto;
}) {
  const router = useRouter();

  if (!data.campaignExists) {
    return (
      <Stack spacing={3}>
        <AutonomyHeading
          title="Paper Bot"
          action={<KillSwitchButton engaged={data.killSwitchEngaged} />}
        />
        <AutonomyTabs current="/autonomy" />
        <Paper>
          <EmptyState
            title="No paper campaign configured."
            detail="Set a starting bankroll and risk mode in Settings to start the three paper portfolios."
            action={{ label: "Settings", href: "/autonomy/settings" }}
          />
        </Paper>
        <ReadinessSummary readiness={data.readiness} />
      </Stack>
    );
  }

  const leader = leadingPortfolio(data);

  function onPeriod(value: string) {
    router.push(`/autonomy${value === "campaign" ? "" : `?period=${value}`}`);
  }

  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Paper Bot"
        action={<KillSwitchButton engaged={data.killSwitchEngaged} />}
      />
      <AutonomyTabs current="/autonomy" />

      {data.portfolioBreaches
        .filter((p) => p.breaches.length > 0)
        .map((p) => {
          const halting = p.breaches.filter((b) => b.halts);
          return (
            <Alert
              key={p.portfolio}
              severity={halting.length > 0 ? "error" : "warning"}
              role="alert"
              action={
                halting.length > 0 ? (
                  <Stack direction="row" spacing={1}>
                    <ResumeButton portfolio={p.portfolio} />
                    <Button
                      size="small"
                      variant="outlined"
                      component={Link}
                      href="/autonomy/override"
                      sx={{
                        color: "warning.main",
                        borderColor: "warning.main",
                      }}
                    >
                      Force override →
                    </Button>
                  </Stack>
                ) : undefined
              }
            >
              <AlertTitle>
                {PORTFOLIO_LABEL[p.portfolio]} portfolio{" "}
                {halting.length > 0 ? "halted" : "warning"}
              </AlertTitle>
              <Stack spacing={0.5}>
                {p.breaches.map((breach) => (
                  <Typography key={breach.id} variant="body2">
                    {breach.label} — measured {breach.measuredDisplay},
                    threshold {breach.thresholdDisplay}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          );
        })}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <TextField
          select
          size="small"
          label="Period"
          value={data.period}
          onChange={(event) => onPeriod(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          {PERIODS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <NumericText size="sm" sx={{ color: "text.secondary" }}>
          {`$${(data.startingBankrollCents / 100).toLocaleString("en-US")} start`}
          {data.riskModeName ? ` · ${data.riskModeName}` : ""}
        </NumericText>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        {data.scorecards.map((scorecard) => (
          <PortfolioScorecard key={scorecard.portfolio} scorecard={scorecard} />
        ))}
      </Stack>

      <Box>
        {leader ? (
          <Typography variant="body2">
            Leading by paper P&amp;L: {PORTFOLIO_LABEL[leader.portfolio]} (
            {leader.netPnlCents >= 0 ? "+" : "−"}$
            {(Math.abs(leader.netPnlCents) / 100).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            ).{" "}
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          This is a financial result over a small number of positions, not proof
          of model quality.{" "}
          <Box
            component={Link}
            href="/model-performance"
            sx={{ color: "primary.main", textDecoration: "none" }}
          >
            See Model Performance for calibration evidence →
          </Box>
        </Typography>
        <Typography variant="caption" sx={{ color: "text.muted" }}>
          Portfolios may evaluate different opportunity sets — counts shown on
          each scorecard.
        </Typography>
      </Box>

      <Paper sx={{ px: 2, py: 1.5 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>
          Bankroll history
        </Typography>
        <MultiBankrollChart
          series={data.bankrollSeries.map((s) => ({
            portfolio: s.portfolio,
            points: s.points,
          }))}
          highWaterMarkCents={Math.max(
            ...data.bankrollSeries.map((s) => s.highWaterMarkCents),
            0,
          )}
          haltThresholdCents={
            data.bankrollSeries
              .map((s) => s.haltThresholdCents)
              .filter((v): v is number => v !== null)
              .sort((a, b) => a - b)[0] ?? null
          }
        />
      </Paper>

      <ReadinessSummary readiness={data.readiness} />
    </Stack>
  );
}

function leadingPortfolio(
  data: PaperBotPerformanceDto,
): { portfolio: string; netPnlCents: number } | null {
  const withPnl = data.scorecards
    .filter((s) => s.netPnlCents !== null)
    .map((s) => ({ portfolio: s.portfolio, netPnlCents: s.netPnlCents! }));
  if (withPnl.length === 0) return null;
  return withPnl.reduce((best, current) =>
    current.netPnlCents > best.netPnlCents ? current : best,
  );
}

function ResumeButton({ portfolio }: { portfolio: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/autonomy/resume", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "Resume failed.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resume failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="small"
      variant="outlined"
      onClick={resume}
      disabled={pending}
      aria-label={`Resume ${portfolio} portfolio if the condition has cleared`}
    >
      {error ? "Retry resume" : "Resume"}
    </Button>
  );
}

/**
 * The readiness summary strip with its criterion detail one click away (D21).
 * Nothing safety-relevant is deleted; the detail expander reveals the former
 * Readiness screen's rows inline. The copy states the reset-on-switch rule (D2)
 * and the never-auto-enable rule so the fraction is never mistaken for
 * permission.
 */
function ReadinessSummary({
  readiness,
}: {
  readiness: PaperBotPerformanceDto["readiness"];
}) {
  const [open, setOpen] = useState(false);
  const stateCopy = {
    not_ready: "not ready",
    paper_evidence_building: "paper evidence building",
    eligible_for_live_trading: "eligible for live trading",
  }[readiness.state];
  const tone = {
    not_ready: "text.secondary",
    paper_evidence_building: "warning.main",
    eligible_for_live_trading: "primary.main",
  }[readiness.state];

  const categories = [
    { key: "paper_evidence", label: "Paper evidence" },
    { key: "model_quality", label: "Model quality" },
    { key: "safety_operations", label: "Safety and operations" },
  ] as const;

  return (
    <Paper sx={{ px: 2, py: 1.5 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.5 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="h2">Real-money readiness</Typography>
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
            {stateCopy}
          </Box>
        </Stack>
        <Button size="small" variant="text" onClick={() => setOpen((v) => !v)}>
          {open ? "Detail ⌃" : "Detail ⌄"}
        </Button>
      </Stack>

      <Typography variant="body2">
        Evaluating the active configuration:{" "}
        {PORTFOLIO_LABEL[readiness.activeConfigurationPortfolio]}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {readiness.weeksComplete} of {readiness.weeksRequired} required NFL
        weeks complete · Paper result:{" "}
        {readiness.paperResultPositive ? "Positive" : "—"} · Model quality:{" "}
        {readiness.modelQualityHealthy ? "Healthy" : "Building"} · Operational
        record: {readiness.operationalHealthy ? "Healthy" : "Attention"}
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: "text.muted", display: "block", mt: 0.5 }}
      >
        Switching the active configuration resets this clock against the new
        configuration&apos;s own portfolio. Readiness never enables real-money
        trading — that is a separate human act in the later Kalshi Live Trading
        capability.
      </Typography>

      <Collapse in={open}>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {categories.map((category) => {
            const rows = readiness.criteria.filter(
              (c) => c.category === category.key,
            );
            if (rows.length === 0) return null;
            return (
              <Box key={category.key}>
                <Typography variant="label" sx={{ color: "text.secondary" }}>
                  {category.label}
                </Typography>
                {rows.map((criterion) => (
                  <Box
                    key={criterion.key}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "18px 1fr",
                      columnGap: 1.25,
                      py: 0.75,
                      borderBottom: 1,
                      borderColor: "divider",
                    }}
                  >
                    <Typography
                      component="span"
                      role="img"
                      aria-label={criterion.met ? "met" : "not met"}
                      sx={{
                        color: criterion.met ? "primary.main" : "error.main",
                        fontSize: 14,
                      }}
                    >
                      {criterion.met ? "✓" : "✗"}
                    </Typography>
                    <Box>
                      <Typography variant="body2">{criterion.label}</Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary" }}
                      >
                        {criterion.evidence}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            );
          })}
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            {readiness.disclaimer}
          </Typography>
        </Stack>
      </Collapse>
    </Paper>
  );
}
