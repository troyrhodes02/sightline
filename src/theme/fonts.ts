import localFont from "next/font/local";

/**
 * The CSS custom property the font is published under.
 *
 * `next/font` requires its options to be **literal**, so the name is written
 * out again in the `localFont` call below rather than referenced. A test in
 * `theme.test.ts` reads this file and asserts the two agree, because a silent
 * disagreement here has no runtime symptom beyond the wrong typeface.
 *
 * Do not reach for `spaceGrotesk.variable` to build a `var()` expression. That
 * property is a **generated class name**, not a custom-property name, so
 * `var(${spaceGrotesk.variable})` produces `var(spacegrotesk_abc__variable)` —
 * invalid CSS that no tool reports and every browser silently discards, falling
 * back to `system-ui`. This exact mistake shipped once already and went
 * unnoticed because nothing failed; it just rendered in the wrong typeface.
 */
export const FONT_FAMILY_VARIABLE = "--font-space-grotesk";

/**
 * Space Grotesk, self-hosted from `src/assets/fonts/`.
 *
 * One family for everything — interface text and every numeric alike. Loading
 * through `next/font/local` is what produces the hashed filename, the preload
 * hint, and the generated `@font-face` with `font-display: swap`; serving it
 * statically from `public/` would lose all three.
 *
 * One variable file covering 300–700, so the three weights the type scale uses
 * — 400 for body and data, 500 for labels, 600 for screen titles — cost a
 * single 36 KB request rather than three.
 *
 * **Its default figures are proportional.** Ten digits, nine different advance
 * widths. Column alignment therefore depends entirely on
 * `font-variant-numeric: tabular-nums`, which the theme sets on every numeric
 * variant. See `src/assets/fonts/space-grotesk/README.md`.
 */
export const spaceGrotesk = localFont({
  src: [
    {
      path: "../assets/fonts/space-grotesk/SpaceGrotesk-Variable.woff2",
      weight: "300 700",
      style: "normal",
    },
  ],
  // Must be a literal — next/font rejects a reference. Kept in step with
  // FONT_FAMILY_VARIABLE above by a test.
  variable: "--font-space-grotesk",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
