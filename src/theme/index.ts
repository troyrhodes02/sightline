import { createTheme, type Shadows } from "@mui/material/styles";
import { FONT_FAMILY_VARIABLE } from "./fonts";

/**
 * Sightline's Material UI theme — the named deliverable of Pitch 3.
 *
 * **This is the only file in the repository permitted to contain a colour
 * literal.** An ESLint rule fails the build on a hex, `rgb()`, `hsl()`, or
 * named CSS colour anywhere else under `src/`. If a screen needs a value that
 * is not here, the theme is incomplete and gets extended — an inline one-off is
 * exactly the drift this pitch is sequenced ahead of Pitch 4 to prevent.
 *
 * ## Colour carries source, not sentiment
 *
 * The rule most often broken by accident, so it is stated where the values are:
 *
 *   - **Model accent (indigo)** marks anything Sightline computed — projected
 *     value, interval, threshold probability, confidence, drivers.
 *   - **Market mint** marks anything Kalshi supplied — price, both sides of the
 *     book, spread, settlement. Nothing model-derived ever wears mint.
 *   - **Amber** is caution only: staleness, degraded mode, low confidence,
 *     insufficient sample, a failed scheduled job. Never "bad price", never
 *     "loss".
 *   - **Rose** marks negative edge and destructive actions, desaturated so it
 *     reads as a data encoding rather than a payout.
 *
 * Two mint tokens exist because `#4DE4B2` fails contrast for body-size text on
 * white. Light mode uses `main` (`#0F9C6E`) for any market value at 16px or
 * below and `fill` for larger elements and chart strokes.
 *
 * ## One family, and why `tabular-nums` now carries the load
 *
 * Space Grotesk sets both interface text and every numeric. Its default figures
 * are **proportional** — ten digits, nine different widths — so column
 * alignment down a long slate depends entirely on
 * `font-variant-numeric: tabular-nums` on the numeric variants below. With a
 * monospace face that setting was belt and braces; here it is the only
 * mechanism, and removing it breaks every numeric column silently.
 */

// FONT_FAMILY_VARIABLE, not `spaceGrotesk.variable` — the latter is a generated
// CLASS name, and `var(<class-name>)` is invalid CSS that browsers discard
// silently. See the note in ./fonts.
const sans = `var(${FONT_FAMILY_VARIABLE}), system-ui, sans-serif`;

// Elevation is carried by 1px borders and background lightness steps. MUI's own
// shadows survive only where MUI itself uses them — menus at 8, dialogs at 24.
const shadows = createTheme().shadows.map((shadow, i) =>
  i >= 1 && i <= 7 ? "none" : shadow,
) as Shadows;

const numeric = {
  fontFamily: sans,
  fontWeight: 400,
  // Load-bearing, not cosmetic. See the note above.
  fontVariantNumeric: "tabular-nums" as const,
};

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data-mui-color-scheme" },

  colorSchemes: {
    light: {
      palette: {
        mode: "light",
        primary: {
          main: "#5B51E8",
          light: "#4A40D6", // hover
          dark: "#3F35C4", // pressed
          soft: "#EFEDFF",
          contrastText: "#FFFFFF",
        },
        market: {
          main: "#0F9C6E", // text and elements at or below 16px
          fill: "#4DE4B2", // fills, chart strokes, elements above 24px
          soft: "#E6FAF3",
          contrastText: "#FFFFFF",
        },
        warning: { main: "#B57414", soft: "#FDF3E2", contrastText: "#FFFFFF" },
        error: { main: "#C4425F", soft: "#FCEBEF", contrastText: "#FFFFFF" },
        divider: "#E4E4E7",
        border: { strong: "#C9C9CF" },
        background: {
          default: "#FAFAFA",
          paper: "#FFFFFF",
          elevated: "#FFFFFF",
        },
        text: { primary: "#131316", secondary: "#5C5C66", muted: "#8A8A93" },
      },
    },
    dark: {
      palette: {
        mode: "dark",
        primary: {
          main: "#7C74FF",
          light: "#8F88FF",
          dark: "#6A61F0",
          soft: "#1E1C3A",
          contrastText: "#0A0A0B",
        },
        market: {
          main: "#4DE4B2",
          fill: "#4DE4B2",
          soft: "#12332A",
          contrastText: "#0A0A0B",
        },
        warning: { main: "#E8A33D", soft: "#33260F", contrastText: "#0A0A0B" },
        error: { main: "#E06C8A", soft: "#3A1C25", contrastText: "#0A0A0B" },
        divider: "#26262A",
        border: { strong: "#35353B" },
        // Near-black, never navy. If a dark surface has a hue, it is wrong.
        background: {
          default: "#0A0A0B",
          paper: "#131315",
          elevated: "#1A1A1D",
        },
        text: { primary: "#ECECEE", secondary: "#9B9BA3", muted: "#6B6B73" },
      },
    },
  },

  shape: { borderRadius: 6 },
  spacing: 8,
  shadows,

  // The scale sits one step above where it started: body 15 rather than 14,
  // titles 22 rather than 20, and the control heights below moved with it so
  // the density reads deliberate rather than merely zoomed.
  typography: {
    fontFamily: sans,
    htmlFontSize: 16, // browser text-size preferences still scale
    fontSize: 15,
    h1: {
      fontFamily: sans,
      fontSize: 22,
      lineHeight: "30px",
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h2: { fontFamily: sans, fontSize: 18, lineHeight: "26px", fontWeight: 500 },
    body1: {
      fontFamily: sans,
      fontSize: 15,
      lineHeight: "22px",
      fontWeight: 400,
    },
    body2: {
      fontFamily: sans,
      fontSize: 14,
      lineHeight: "20px",
      fontWeight: 400,
    },
    label: {
      fontFamily: sans,
      fontSize: 13,
      lineHeight: "18px",
      fontWeight: 500,
    },
    caption: {
      fontFamily: sans,
      fontSize: 13,
      lineHeight: "18px",
      fontWeight: 400,
    },
    numericLg: { ...numeric, fontSize: 22, lineHeight: "30px" },
    numericMd: { ...numeric, fontSize: 15, lineHeight: "22px" },
    numericSm: { ...numeric, fontSize: 13, lineHeight: "18px" },
    button: { textTransform: "none", fontWeight: 500 },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: (t) => ({
        ":focus-visible": {
          outline: `2px solid ${t.vars.palette.primary.main}`,
          outlineOffset: 2,
        },
        body: { backgroundColor: t.vars.palette.background.default },
      }),
    },

    MuiTypography: {
      defaultProps: {
        variantMapping: {
          h1: "h1",
          h2: "h2",
          body1: "p",
          body2: "p",
          label: "span",
          numericLg: "span",
          numericMd: "span",
          numericSm: "span",
        },
      },
    },

    // Cards are bordered, not floated.
    MuiPaper: {
      defaultProps: { variant: "outlined" },
      styleOverrides: { root: { backgroundImage: "none" } },
    },

    MuiAppBar: {
      defaultProps: { color: "transparent", elevation: 0 },
      styleOverrides: {
        root: ({ theme: t }) => ({
          backgroundColor: t.vars.palette.background.paper,
          borderBottom: `1px solid ${t.vars.palette.divider}`,
        }),
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 40 },
        sizeSmall: { minHeight: 34 },
      },
    },

    // 4px radius. There are no pill badges in this product.
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 4, fontWeight: 500 },
        sizeSmall: { height: 24, fontSize: 13 },
        label: { paddingInline: 9 },
      },
    },

    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: ({ theme: t }) => ({
          borderColor: t.vars.palette.border.strong,
        }),
      },
    },

    MuiAlert: {
      defaultProps: { variant: "outlined" },
      styleOverrides: { root: { borderRadius: 6 } },
    },

    MuiTabs: {
      styleOverrides: { indicator: { height: 2 }, root: { minHeight: 60 } },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          minHeight: 60,
          minWidth: 0,
          paddingInline: 14,
          fontSize: 15,
          fontWeight: 500,
          color: t.vars.palette.text.secondary,
          "&.Mui-selected": { color: t.vars.palette.primary.main },
        }),
      },
    },

    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          fontWeight: 500,
          borderColor: t.vars.palette.divider,
          "&.Mui-selected": {
            backgroundColor: t.vars.palette.primary.soft,
            color: t.vars.palette.primary.main,
          },
        }),
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderBottomColor: t.vars.palette.divider,
          paddingBlock: 14,
        }),
        head: ({ theme: t }) => ({
          fontSize: 13,
          fontWeight: 500,
          color: t.vars.palette.text.secondary,
        }),
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: ({ theme: t }) => ({
          backgroundColor: t.vars.palette.background.elevated,
          backgroundImage: "none",
        }),
      },
    },

    MuiDialog: { defaultProps: { maxWidth: "xs", fullWidth: true } },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: 16, fontWeight: 500 } },
    },

    // Pulse, never a shimmer sweep — data does not animate in.
    MuiSkeleton: { defaultProps: { animation: "pulse" } },
    MuiLinearProgress: { styleOverrides: { root: { height: 2 } } },
    MuiLink: { defaultProps: { underline: "hover" } },
  },
});
