import localFont from "next/font/local";

/**
 * IBM Plex, self-hosted from `src/assets/fonts/` rather than served from
 * `public/`. Loading through `next/font/local` is what produces the hashed
 * filename, the preload hint, and the generated `@font-face` with
 * `font-display: swap`; serving them statically loses all three.
 *
 * **Four faces, deliberately.** Plex Sans variable roman for interface text,
 * and Plex Mono 400 and 500 upright for every numeric the product displays.
 * Italics are never used anywhere in Sightline, and no weight below 400 or
 * above 600 appears in the type scale. The rest of the licensed set stays on
 * disk unimported, which costs nothing — an unimported font never ships.
 */

export const plexSans = localFont({
  src: [
    {
      path: "../assets/fonts/ibm-plex-sans/IBMPlexSans-VariableFont_wdth,wght.ttf",
      weight: "100 700",
      style: "normal",
    },
  ],
  variable: "--font-plex-sans",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const plexMono = localFont({
  src: [
    {
      path: "../assets/fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../assets/fonts/ibm-plex-mono/IBMPlexMono-Medium.ttf",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});
