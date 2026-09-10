import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { NumericText } from "@/components/primitives/NumericText";
import {
  isMoneyAvailable,
  type BreachDto,
  type ExposureMeterDto,
  type MoneyDto,
  type RiskModeDto,
} from "@/lib/dto/autonomy";
import type { BindingConstraint } from "../../../generated/prisma/enums";

/**
 * The shared vocabulary of the Autonomy surfaces.
 *
 * Two rules run through all of it.
 *
 * **Ledger money is neutral-toned.** Bankroll, stake, fill, exposure and P&L
 * render in `text.primary`, never in the market mint — mint means "Kalshi told
 * us this", and the paper bankroll is Sightline's own fiction. Only a signed
 * P&L takes colour, and its sign is always printed so the encoding survives
 * greyscale.
 *
 * **Unavailable is a rendered value, not a blank.** `MoneyDto` is a union so a
 * missing mark cannot silently become zero dollars.
 */

export function formatCents(cents: number, signed = false): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  // Zero takes no sign even in signed contexts. A voided position's P&L is
  // exactly zero, and rendering it as "+$0.00" would read as a small gain —
  // which is the one thing a void is not.
  const sign = cents < 0 ? "−" : signed && cents > 0 ? "+" : "";
  return `${sign}$${dollars}.${remainder}`;
}

export function formatMoney(value: MoneyDto, signed = false): string {
  return isMoneyAvailable(value)
    ? formatCents(value.cents, signed)
    : "unavailable";
}

/** The permanent simulated disclosure. Present on every Autonomy surface. */
export function PaperModeSubtitle({ detail }: { detail?: string }) {
  return (
    <Typography variant="caption" sx={{ color: "text.muted" }}>
      {detail ?? "Paper mode · all figures simulated"}
    </Typography>
  );
}

export function AutonomyHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: { xs: "stretch", sm: "flex-start" },
      }}
    >
      <Box>
        <Typography variant="h1">{title}</Typography>
        <PaperModeSubtitle detail={detail} />
      </Box>
      {action}
    </Stack>
  );
}

export function RiskModeChip({ mode }: { mode: RiskModeDto }) {
  // Aggressive wears the caution tone: more permitted risk is a caution, not
  // an achievement. Custom carries its fraction inline so the number a
  // deliberately tuned campaign runs on is never one click away.
  const tone =
    mode.mode === "aggressive"
      ? "warning.main"
      : mode.mode === "custom"
        ? "primary.main"
        : "text.secondary";
  const label =
    mode.mode === "custom"
      ? `custom · ${mode.kellyFraction.toFixed(2)}×`
      : mode.mode;

  return (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      sx={{
        color: tone,
        borderColor: tone === "text.secondary" ? "border.strong" : tone,
      }}
    />
  );
}

/** One headline figure with its decomposition. */
export function Figure({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const colour =
    tone === "positive"
      ? "primary.main"
      : tone === "negative"
        ? "error.main"
        : "text.primary";

  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: 2,
        py: 1.5,
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <NumericText size="lg" sx={{ color: colour, display: "block" }}>
        {value}
      </NumericText>
      {sub ? (
        <NumericText size="sm" sx={{ color: "text.muted", display: "block" }}>
          {sub}
        </NumericText>
      ) : null}
    </Box>
  );
}

/**
 * Exposure against its cap.
 *
 * An ARIA meter, and both the cap's dollar value and its percentage render — a
 * percentage alone is unauditable, because the reader cannot tell what it is a
 * percentage of without doing arithmetic the screen should have done.
 */
export function ExposureMeter({ meter }: { meter: ExposureMeterDto }) {
  const ratio = meter.capCents > 0 ? meter.usedCents / meter.capCents : 0;
  const full = ratio >= 1;

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      sx={{ py: 0.75, alignItems: { xs: "stretch", sm: "center" } }}
    >
      <Typography
        variant="body2"
        sx={{ color: "text.secondary", width: { sm: 96 }, flexShrink: 0 }}
      >
        {meter.label}
      </Typography>
      <Box
        role="meter"
        aria-label={`${meter.label} exposure`}
        aria-valuenow={meter.usedCents}
        aria-valuemin={0}
        aria-valuemax={meter.capCents}
        aria-valuetext={`${formatCents(meter.usedCents)} of ${formatCents(meter.capCents)}`}
        sx={{
          flex: 1,
          height: 8,
          borderRadius: 0.5,
          border: 1,
          borderColor: "border.strong",
          backgroundColor: "background.default",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
            height: "100%",
            backgroundColor: full ? "error.main" : "primary.main",
          }}
        />
      </Box>
      <NumericText size="sm" sx={{ color: "text.secondary", flexShrink: 0 }}>
        {formatCents(meter.usedCents)} / {formatCents(meter.capCents)} ·{" "}
        {meter.capPct}%
      </NumericText>
    </Stack>
  );
}

const BOUND_BY_COPY: Record<BindingConstraint, string> = {
  none: "none",
  top_of_book_size: "top-of-book size",
  per_game_cap: "per-game cap",
  per_slate_cap: "per-slate cap",
  available_bankroll: "available bankroll",
  probability_ceiling: "probability ceiling",
  no_edge_after_fees: "no edge after fees",
  stale_projection: "stale projection",
  price_unavailable: "price unavailable",
  pre_kickoff_cutoff: "10-minute cutoff",
  breaker: "breaker",
  no_active_recalibration: "no active recalibration",
  opposite_side_held: "opposite side held",
  pending_suggestion: "pending suggestion",
};

/**
 * The single named constraint that determined a candidate's outcome.
 *
 * **Never renders blank.** A closed set with a value for every case, including
 * `none` when nothing bound it — an empty cell here would read as "we did not
 * check", which is the one thing the audit trail must never say.
 */
export function BoundByLabel({
  boundBy,
  detail,
}: {
  boundBy: BindingConstraint;
  detail: string | null;
}) {
  const text = BOUND_BY_COPY[boundBy] ?? boundBy;
  return (
    <Typography variant="body2">
      <Box component="span" sx={{ color: "text.secondary" }}>
        bound by:{" "}
      </Box>
      {detail ? `${text} — ${detail}` : text}
    </Typography>
  );
}

/**
 * One breach, in the shape it takes everywhere it appears.
 *
 * The same four facts in the banner, the override route, and the review table,
 * so the operator is never asked to accept a condition described differently
 * from how they last saw it.
 */
export function BreachFacts({ breach }: { breach: BreachDto }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "104px 1fr" },
        gap: 0.5,
        columnGap: 2,
      }}
    >
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        condition
      </Typography>
      <Typography variant="body2">{breach.conditionDescription}</Typography>

      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        measured
      </Typography>
      <NumericText size="sm">{breach.measuredDisplay}</NumericText>

      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        threshold
      </Typography>
      <NumericText size="sm">{breach.thresholdDisplay}</NumericText>

      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        tripped
      </Typography>
      <NumericText size="sm">{formatTimestamp(breach.trippedAt)}</NumericText>
    </Box>
  );
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatKickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
