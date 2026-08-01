import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  NumericText,
  type NumericSize,
} from "@/components/primitives/NumericText";
import type { Confidence, Disposition } from "../../../generated/prisma/enums";

/**
 * The numeric display primitives of the slate. Colour carries **source, not
 * sentiment**: model accent for anything Sightline computed, market mint for
 * anything Kalshi supplied, rose only for negative edge. Every encoding also
 * survives greyscale — edge carries a sign and a glyph, confidence carries
 * its word, and a missing value is an em dash, never a zero.
 */

/** Model-derived probability, always paired with its confidence by callers. */
export function ProbabilityValue({
  value,
  size = "md",
}: {
  value: number | null;
  size?: NumericSize;
}) {
  if (value === null) {
    return (
      <NumericText size={size} muted aria-label="no projection">
        —
      </NumericText>
    );
  }
  return (
    <NumericText size={size} sx={{ color: "primary.main" }}>
      {(value * 100).toFixed(1)}%
    </NumericText>
  );
}

/** Market-derived price in integer cents. Mint = Kalshi provenance. */
export function PriceValue({
  cents,
  size = "md",
}: {
  cents: number | null;
  size?: NumericSize;
}) {
  if (cents === null) {
    return (
      <NumericText size={size} muted aria-label="no current price">
        —
      </NumericText>
    );
  }
  return (
    <NumericText size={size} sx={{ color: "market.main" }}>
      {cents}¢
    </NumericText>
  );
}

/** Signed edge with glyph: direction survives colourblindness and greyscale. */
export function EdgeValue({
  points,
  size = "md",
}: {
  points: number | null;
  size?: NumericSize;
}) {
  if (points === null) {
    return (
      <NumericText size={size} muted aria-label="no edge">
        —
      </NumericText>
    );
  }
  const positive = points >= 0;
  return (
    <NumericText
      size={size}
      sx={{ color: positive ? "primary.main" : "error.main" }}
    >
      {positive ? "▲ +" : "▼ −"}
      {Math.abs(points).toFixed(1)}
    </NumericText>
  );
}

/** The confidence word beside the probability it qualifies. */
export function ConfidenceValue({
  confidence,
  size = "md",
}: {
  confidence: Confidence | null;
  size?: NumericSize;
}) {
  return (
    <NumericText size={size} muted={confidence === null}>
      {confidence ?? "—"}
    </NumericText>
  );
}

/**
 * The admin's disposition. Three states and only three — unmarked renders
 * NOTHING (callers omit the chip entirely), never a fourth variant.
 */
export function DispositionChip({ disposition }: { disposition: Disposition }) {
  if (disposition === "took") {
    return (
      <Chip
        size="small"
        label="took"
        sx={{
          bgcolor: "primary.main",
          color: "primary.contrastText",
          borderColor: "primary.main",
        }}
      />
    );
  }
  if (disposition === "faded") {
    return (
      <Chip
        size="small"
        label="faded"
        sx={{
          bgcolor: "error.main",
          color: "error.contrastText",
          borderColor: "error.main",
        }}
      />
    );
  }
  return (
    <Chip
      size="small"
      label="skipped"
      variant="outlined"
      sx={{ color: "text.secondary", borderColor: "border.strong" }}
    />
  );
}

const ET = "America/New_York";

/** "Thu 9:12 AM" / "11:42 AM" in ET — same-day timestamps drop the weekday. */
export function formatEt(iso: string, now: Date = new Date()): string {
  const value = new Date(iso);
  const sameDay =
    new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      dateStyle: "short",
    }).format(value) ===
    new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      dateStyle: "short",
    }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
  if (sameDay) return time;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(value);
  return `${weekday} ${time}`;
}

/** "Sun, Nov 8" in ET. */
export function formatEtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** "1:00 PM" kickoff time in ET. */
export function formatEtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * The two clocks, side by side and never merged: projection age and price
 * age are different facts about a row. Title attributes carry the absolutes.
 *
 * Ages are server-computed strings rendered verbatim (RD-28) — no clock math
 * happens here, no ticking. At `xs` the absolute times yield to ages alone
 * (`proj 2d 4h`); the absolutes live on the detail view.
 */
export function RowTimestamps({
  projectionComputedAt,
  projectionAge,
  priceObservedAt,
  priceAge,
}: {
  projectionComputedAt: string | null;
  projectionAge?: string | null;
  priceObservedAt: string | null;
  priceAge?: string | null;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="numericSm"
        sx={{ color: "text.muted" }}
        title={projectionComputedAt ?? undefined}
      >
        proj <Clock at={projectionComputedAt} age={projectionAge ?? null} />
      </Typography>
      <Typography
        variant="numericSm"
        sx={{ color: "text.muted" }}
        title={priceObservedAt ?? undefined}
      >
        price <Clock at={priceObservedAt} age={priceAge ?? null} />
      </Typography>
    </Stack>
  );
}

/** `Thu 9:12 AM (2d 4h)` at sm+; the age alone at xs; an em dash when absent. */
function Clock({ at, age }: { at: string | null; age: string | null }) {
  if (!at) return <>—</>;
  return (
    <>
      <Box
        component="span"
        sx={{ display: { xs: "none", sm: "inline" } }}
      >{`${formatEt(at)}${age ? " " : ""}`}</Box>
      {age ? (
        <>
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            ({age})
          </Box>
          <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
            {age}
          </Box>
        </>
      ) : (
        <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
          {formatEt(at)}
        </Box>
      )}
    </>
  );
}
