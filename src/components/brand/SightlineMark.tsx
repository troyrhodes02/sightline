import Box, { type BoxProps } from "@mui/material/Box";

/**
 * The reticle mark alone: a stroked circle, four tick marks, a quarter-arc from
 * twelve to three o'clock, and a centre dot.
 *
 * Everything is `currentColor`, so it adopts the surrounding text colour in
 * both appearance modes from one component. **Do not redesign it, do not
 * recolour the arc, and do not add the wordmark** — where the mark stands
 * alone, it stands alone.
 *
 * Used at `xs`, where the full lockup would crowd a 375px app bar.
 */
export function SightlineMark({
  size = 20,
  sx,
  ...rest
}: BoxProps & { size?: number }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 64 64"
      role="img"
      aria-label="Sightline"
      sx={{ width: size, height: size, display: "block", ...sx }}
      {...rest}
    >
      <circle
        cx="32"
        cy="32"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <path
        d="M32 12 A20 20 0 0 1 52 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <line
        x1="32"
        y1="5"
        x2="32"
        y2="12"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <line
        x1="32"
        y1="52"
        x2="32"
        y2="59"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <line
        x1="5"
        y1="32"
        x2="12"
        y2="32"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <line
        x1="52"
        y1="32"
        x2="59"
        y2="32"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="32" cy="32" r="3.4" fill="currentColor" />
    </Box>
  );
}
