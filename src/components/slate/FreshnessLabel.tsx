import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { FreshnessStateDto } from "@/lib/dto/slate";

/**
 * The five plain-language freshness states (spec §5, design doc §4.2 / Screen 6),
 * derived from `FreshnessStateDto`. This is a DISPLAY mapping over the two clocks
 * SIG-95 already resolved — it never merges them and never derives its own state,
 * it renders the state it is given.
 *
 * Freshness carries a WORD, never colour alone (design doc §10): every state has
 * its label, and the two caution states additionally carry a dot so the encoding
 * survives greyscale. `current` / `updated_recently` are neutral; `stale` /
 * `new_info_pending` are the caution register (amber); `unavailable` is muted.
 */

type FreshnessDisplay = {
  label: string;
  /** Theme colour path. */
  color: string;
  /** A leading dot reinforces the caution states (never the only channel). */
  dot: boolean;
};

const DISPLAY: Record<FreshnessStateDto["state"], FreshnessDisplay> = {
  current: { label: "Current", color: "text.secondary", dot: false },
  updated_recently: {
    label: "Updated recently",
    color: "text.secondary",
    dot: false,
  },
  new_info_pending: {
    label: "New info pending",
    color: "warning.main",
    dot: true,
  },
  stale: { label: "Stale", color: "warning.main", dot: true },
  unavailable: { label: "Unavailable", color: "text.muted", dot: false },
};

export function FreshnessLabel({
  freshness,
  size = "sm",
}: {
  freshness: FreshnessStateDto;
  /** `sm` for cards and group headers; `md` for detail. */
  size?: "sm" | "md";
}) {
  const display = DISPLAY[freshness.state];
  return (
    <Stack
      direction="row"
      spacing={0.75}
      component="span"
      sx={{ alignItems: "center", flexShrink: 0 }}
    >
      {display.dot ? (
        <Box
          component="span"
          aria-hidden
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: display.color,
            flexShrink: 0,
          }}
        />
      ) : null}
      <Typography
        component="span"
        variant={size === "md" ? "body2" : "numericSm"}
        sx={{ color: display.color }}
      >
        {display.label}
      </Typography>
    </Stack>
  );
}
