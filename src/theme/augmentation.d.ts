import type { CSSProperties } from "react";
import type { PaletteColor, PaletteColorOptions } from "@mui/material/styles";

/**
 * Sightline's palette carries **source, not sentiment**, which needs keys MUI
 * does not ship: a `market` colour for anything Kalshi supplied, a `soft` step
 * on each accent, plus muted text and an elevated surface.
 *
 * The type scale adds one label variant and three numeric variants, and
 * disables the MUI heading levels the design system does not use — a scale with
 * nine heading levels invites a tenth.
 */

declare module "@mui/material/styles" {
  interface Palette {
    market: PaletteColor;
    border: { strong: string };
  }
  interface PaletteOptions {
    market?: PaletteColorOptions;
    border?: { strong: string };
  }
  interface PaletteColor {
    soft: string;
    fill?: string;
  }
  interface SimplePaletteColorOptions {
    soft?: string;
    fill?: string;
  }
  interface TypeText {
    muted: string;
  }
  interface TypeBackground {
    elevated: string;
  }
  interface TypographyVariants {
    label: CSSProperties;
    numericLg: CSSProperties;
    numericMd: CSSProperties;
    numericSm: CSSProperties;
  }
  interface TypographyVariantsOptions {
    label?: CSSProperties;
    numericLg?: CSSProperties;
    numericMd?: CSSProperties;
    numericSm?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    label: true;
    numericLg: true;
    numericMd: true;
    numericSm: true;
    h3: false;
    h4: false;
    h5: false;
    h6: false;
    subtitle1: false;
    subtitle2: false;
    overline: false;
  }
}

export {};
