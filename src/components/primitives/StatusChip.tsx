import Chip from "@mui/material/Chip";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

export type StatusTone = "neutral" | "caution" | "accent";

/**
 * The status indicator every state in this milestone renders through.
 *
 * **Colour is never the only signal.** Every chip carries a text label, and the
 * caution states additionally carry an icon, so the encoding survives greyscale
 * and colourblindness. A chip that communicated only through its tint would be
 * unreadable to a meaningful share of readers and invisible in a screenshot.
 */
export function StatusChip({
  label,
  tone = "neutral",
  filled = false,
  icon = false,
}: {
  label: string;
  tone?: StatusTone;
  filled?: boolean;
  icon?: boolean;
}) {
  const colour = {
    neutral: "text.secondary",
    caution: "warning.main",
    accent: "primary.main",
  }[tone];

  const soft = {
    neutral: "transparent",
    caution: "warning.soft",
    accent: "primary.soft",
  }[tone];

  return (
    <Chip
      size="small"
      label={label}
      icon={icon ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : undefined}
      variant="outlined"
      sx={{
        color: colour,
        borderColor: tone === "neutral" ? "border.strong" : colour,
        bgcolor: filled ? soft : "transparent",
        "& .MuiChip-icon": { color: colour, ml: 0.5 },
      }}
    />
  );
}
