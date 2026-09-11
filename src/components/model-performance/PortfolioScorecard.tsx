import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { NumericText } from "@/components/primitives/NumericText";
import type { PortfolioScorecardDto } from "@/lib/dto/model-eval";

/**
 * One paper portfolio's scorecard (D5/D17/D19/D20).
 *
 * **Money is neutral; only the sign of a P&L figure takes colour (D19).** The
 * ledger dollars (total value, active, withdrawn, starting) render in
 * `text.primary`; only net P&L is tinted — positive in the model accent,
 * negative in error — and even then the sign, not just the hue, carries the
 * direction. No figure here ever wears the market mint: a bankroll is not a
 * market value.
 *
 * **Every figure is a PAPER figure, permanently (D20).** The header says so and
 * the card is never summed with another portfolio's — the three rows stand
 * alone. Both opportunity counts (evaluated and sized) are shown alongside the
 * money (D5) so a bankroll is never displayed without the opportunity set
 * behind it. A `null` mark-to-market renders as an honest "unavailable", not a
 * zero.
 */

const PORTFOLIO_LABEL: Record<PortfolioScorecardDto["portfolio"], string> = {
  baseline: "Baseline",
  simulation: "Simulation",
  hybrid: "Hybrid",
};

function dollars(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return `$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed dollars with a leading sign glyph — the sign carries direction, not colour alone. */
function signedDollars(cents: number): string {
  const sign = cents >= 0 ? "+" : "−";
  return `${sign}${dollars(cents)}`;
}

export function PortfolioScorecard({
  scorecard,
}: {
  scorecard: PortfolioScorecardDto;
}) {
  const degraded = scorecard.activeBankrollCents === null;
  const pnl = scorecard.netPnlCents;
  const pnlColor =
    pnl === null
      ? "text.primary"
      : pnl > 0
        ? "primary.main"
        : pnl < 0
          ? "error.main"
          : "text.primary";

  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 180 }}>
      <Stack spacing={1.25}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Typography variant="label">
            {PORTFOLIO_LABEL[scorecard.portfolio]}
          </Typography>
          <Chip size="small" variant="outlined" label="paper" />
        </Stack>

        <Stack spacing={0.25}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            total value
          </Typography>
          <NumericText size="lg">
            {scorecard.totalValueCents === null
              ? "unavailable"
              : dollars(scorecard.totalValueCents)}
          </NumericText>
        </Stack>

        <Row label="active">
          {degraded ? "unavailable" : dollars(scorecard.activeBankrollCents!)}
        </Row>
        <Row label="withdrawn">{dollars(scorecard.withdrawnCents)}</Row>

        <Stack spacing={0.25}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            P&amp;L
          </Typography>
          <NumericText size="lg" sx={{ color: pnlColor }}>
            {pnl === null ? "unavailable" : signedDollars(pnl)}
          </NumericText>
          <NumericText size="sm" muted>
            {scorecard.returnPct === null
              ? "return —"
              : `return ${scorecard.returnPct >= 0 ? "+" : "−"}${Math.abs(
                  scorecard.returnPct,
                ).toFixed(1)}%`}
            {" · "}
            {scorecard.maxDrawdownBps === null
              ? "max DD —"
              : `max DD ${(scorecard.maxDrawdownBps / 100).toFixed(1)}%`}
          </NumericText>
        </Stack>

        {/* Opportunity set (D5) — never a bankroll without the counts behind it. */}
        <NumericText size="sm" muted>
          evaluated {scorecard.candidatesEvaluated.toLocaleString("en-US")} ·
          sized {scorecard.candidatesSized.toLocaleString("en-US")} ·{" "}
          {scorecard.positionCount.toLocaleString("en-US")} pos
        </NumericText>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {scorecard.riskMode} ·{" "}
          {scorecard.breakerEventCount.toLocaleString("en-US")} breaker event
          {scorecard.breakerEventCount === 1 ? "" : "s"}
        </Typography>
      </Stack>
    </Paper>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: "space-between", alignItems: "baseline" }}
    >
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <NumericText size="sm">{children}</NumericText>
    </Stack>
  );
}
