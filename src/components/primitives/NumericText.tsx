import Typography, { type TypographyProps } from "@mui/material/Typography";

const VARIANT = {
  sm: "numericSm",
  md: "numericMd",
  lg: "numericLg",
} as const;

export type NumericSize = keyof typeof VARIANT;

/**
 * Every number the product computes or displays goes through here.
 *
 * Tabular figures, so a reader scans **down a column** rather than across a row.
 *
 * Space Grotesk's default figures are proportional — ten digits, nine different
 * advance widths — so this component is the only thing keeping numeric columns
 * aligned. Rendering a number outside it will look fine on one row and drift
 * visibly by the sixtieth.
 *
 * Never bolded. Importance is carried by position and colour, not weight.
 */
export function NumericText({
  size = "md",
  muted = false,
  sx,
  children,
  ...rest
}: Omit<TypographyProps, "variant"> & {
  size?: NumericSize;
  muted?: boolean;
}) {
  return (
    <Typography
      variant={VARIANT[size]}
      sx={{ color: muted ? "text.muted" : "text.primary", ...sx }}
      {...rest}
    >
      {children}
    </Typography>
  );
}
