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
 * IBM Plex Mono with tabular figures, so a reader scans **down a column** rather
 * than across a row — which is the entire reason the mono family is in the
 * brand system. Proportional figures defeat it, and sixty slate rows is where
 * that becomes obvious.
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
