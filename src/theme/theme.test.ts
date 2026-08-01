import { join } from "node:path";
import type { Palette } from "@mui/material/styles";
import { theme } from "@/theme";
import { productionFiles, readCode } from "@/lib/testing/source";

// `createTheme` returns the merged theme; the per-scheme palettes are present
// at runtime but not surfaced on the public `Theme` type. Narrowed once here
// rather than at each assertion.
const schemes = (
  theme as unknown as {
    colorSchemes: Record<"light" | "dark", { palette: Palette }>;
  }
).colorSchemes;

/**
 * The theme is this pitch's named deliverable, so these assert the properties
 * later pitches will silently depend on rather than merely that it loads.
 */
describe("theme", () => {
  it("defines both appearance modes", () => {
    expect(schemes.light).toBeDefined();
    expect(schemes.dark).toBeDefined();
  });

  it("carries the custom palette keys the design system needs", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = schemes[mode].palette;
      expect(palette.market.main).toBeTruthy();
      expect(palette.market.soft).toBeTruthy();
      expect(palette.primary.soft).toBeTruthy();
      expect(palette.warning.soft).toBeTruthy();
      expect(palette.error.soft).toBeTruthy();
      expect(palette.border.strong).toBeTruthy();
      expect(palette.text.muted).toBeTruthy();
      expect(palette.background.elevated).toBeTruthy();
    }
  });

  it("keeps market mint distinct from the model accent in both modes", () => {
    // Colour carries source. If these ever collide, the interface stops being
    // able to say which half of the product a number came from.
    for (const mode of ["light", "dark"] as const) {
      const palette = schemes[mode].palette;
      expect(palette.market.main).not.toBe(palette.primary.main);
    }
  });

  it("uses a separate, higher-contrast mint for light-mode text", () => {
    const light = schemes.light.palette;
    const dark = schemes.dark.palette;

    // #4DE4B2 fails contrast for body-size text on white, which is the entire
    // reason two mint tokens exist.
    expect(light.market.main).not.toBe(light.market.fill);
    expect(dark.market.main).toBe(dark.market.fill);
  });

  it("keeps dark surfaces neutral rather than navy", () => {
    const dark = schemes.dark.palette;

    for (const surface of [
      dark.background.default,
      dark.background.paper,
      dark.background.elevated,
    ]) {
      const [r, g, b] = [1, 3, 5].map((i) =>
        parseInt(surface.slice(i, i + 2), 16),
      );
      // A hue would show up as a blue channel meaningfully above the others.
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(
        4,
      );
    }
  });

  it("carries no shadow below the elevation MUI uses for menus", () => {
    for (let i = 1; i <= 7; i += 1) {
      expect(theme.shadows[i]).toBe("none");
    }
    // MUI's own menu and dialog surfaces keep theirs.
    expect(theme.shadows[8]).not.toBe("none");
    expect(theme.shadows[24]).not.toBe("none");
  });

  it("reserves weight 600 for screen titles", () => {
    expect(theme.typography.h1.fontWeight).toBe(600);
    expect(theme.typography.h2.fontWeight).toBe(500);
    expect(theme.typography.body1.fontWeight).toBe(400);
  });

  it("sets tabular figures on every numeric variant", () => {
    for (const variant of ["numericSm", "numericMd", "numericLg"] as const) {
      expect(theme.typography[variant].fontVariantNumeric).toBe("tabular-nums");
      // next/font is stubbed under Jest, so assert the distinction that
      // matters — the numeric stack is monospace and differs from body text.
      expect(theme.typography[variant].fontFamily).toContain("monospace");
      expect(theme.typography[variant].fontFamily).not.toBe(
        theme.typography.body1.fontFamily,
      );
      expect(theme.typography[variant].fontWeight).toBe(400);
    }
  });

  it("never uppercases a label", () => {
    expect(theme.typography.button.textTransform).toBe("none");
  });
});

describe("colour literal containment", () => {
  const SRC = join(process.cwd(), "src");
  const THEME = join(SRC, "theme", "index.ts");
  const LOCKUP = join(SRC, "components", "brand", "SightlineLockup.tsx");

  it("confines hex values to the theme and the supplied lockup", () => {
    const offenders = productionFiles(SRC)
      .filter((file) => file !== THEME && file !== LOCKUP)
      .filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(readCode(file)));

    expect(offenders).toEqual([]);
  });
});
