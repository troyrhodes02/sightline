# Sightline Brand Assets

The mark is a circular reticle: a stroked circle with four tick marks, a mint quarter-arc from twelve to three o'clock, and a mint centre dot.

Brand colours are `#7C74FF` (model accent, indigo) and `#4DE4B2` (Kalshi mint). Wordmark type is IBM Plex Sans Regular, **already outlined to paths** — no font needs to be loaded for the lockups to render correctly. Editing the word means regenerating the file, not retyping it.

See `.claude/skills/sightline-ui-design/SKILL.md` for the full brand system and `docs/v1/design-docs/app-shell-brand-and-access-design-doc.md` §4 for the theme these assets sit inside.

## Where everything lives

Three locations, split by how the file is consumed. This is the whole rule: served verbatim, consumed by the build, or never shipped at all.

| Location | What it holds | How it is consumed |
| -------- | ------------- | ------------------ |
| `public/` | Favicon, touch icon, app icons | Served verbatim at a URL. Next.js maps `public/x` to `/x`. |
| `src/assets/` | Logo SVGs, font files | Imported by application code. Bundled, hashed, and tree-shaken at build time — nothing unimported ships. |
| `design/brand/` | Icon source SVGs, this file | Never served, never imported. Regeneration sources only. |

## Logos — `src/assets/brand/`

| File | Use it for |
| ---- | ---------- |
| `logo-lockup-adaptive.svg` | **The default app logo.** Mark in brand colours, wordmark in `currentColor`. Inline it in the DOM and it adapts to light and dark from one file. |
| `logo-lockup-for-dark-backgrounds.svg` | Same lockup with the wordmark fixed at `#ECECEE`. Use in `<img>` tags, READMEs, email — anywhere the SVG is not inlined. |
| `logo-lockup-for-light-backgrounds.svg` | Same, wordmark fixed at `#131316`. |
| `logo-lockup-monochrome.svg` | Everything `currentColor`. Single-colour contexts. |
| `logo-mark-color.svg` | Reticle alone, brand colours. |
| `logo-mark-adaptive.svg` | Reticle alone, `currentColor` — adopts surrounding text colour when inlined. |

**`currentColor` only inherits when the SVG is inlined in the DOM.** In an `<img>` tag it falls back to black, which is why the two fixed-colour lockups exist. The app bar, sign-in, and invitation screens inline the adaptive lockup; the invitation email uses the fixed-colour pair.

## Fonts — `src/assets/fonts/space-grotesk/`

Loaded with `next/font/local` from the source tree, not from `public/`. That is
what gives it a hashed filename, a preload hint, and a generated `@font-face`
with `font-display: swap`.

| File | Notes |
| ---- | ----- |
| `SpaceGrotesk-Variable.woff2` | One variable file, weights 300–700, 36 KB — the whole type scale |
| `OFL.txt` | SIL Open Font License. Stays with the font; the licence requires it. |

**One family for everything** — interface text and every numeric alike. The type
scale uses 400 (body and data values), 500 (labels and column headers), and 600
(screen titles only).

### Tabular figures are load-bearing

Space Grotesk's **default figures are proportional** — its ten digits have nine
different advance widths. Column alignment down a long slate depends entirely on
`font-variant-numeric: tabular-nums`, which the theme sets on every numeric
variant. With a monospace face that was belt and braces; here it is the only
mechanism, and removing it breaks every numeric column with nothing to catch it.

### Do not build `var()` from `next/font`'s `.variable`

That property is a generated **class name**, not a custom-property name.
`` `var(${font.variable})` `` yields invalid CSS which browsers discard silently,
falling back to `system-ui`. Reference `var(--font-space-grotesk)` directly. This
exact mistake shipped once and went unnoticed, because nothing fails — the page
simply renders in the wrong typeface.

## Favicon and icons — `public/`

| File | Use it for |
| ---- | ---------- |
| `favicon.svg` | Browser tab. A **separate drawing**, not a scaled mark — the tick marks are removed and the strokes thickened, because at 16px the ticks turn to mush. |
| `apple-touch-icon.png` | iOS home screen (180×180) |
| `icons/app-icon-pwa-192.png` | PWA manifest |
| `icons/app-icon-playstore-512.png` | Google Play Store, PWA manifest |
| `icons/app-icon-android-maskable-512.png` | Android adaptive icon — `"purpose": "maskable"` in the manifest |
| `icons/app-icon-appstore-1024.png` | iOS App Store submission |

Two filenames are convention-locked and must not be renamed: browsers look for `favicon.svg` by convention, and iOS looks for `apple-touch-icon.png` by convention when no `<link rel="apple-touch-icon">` tag is present. Both sit at the root of `public/` for that reason. The rest are referenced explicitly from the manifest, so their paths are free.

All app icons are opaque white with no alpha channel — the App Store rejects icons that have one.

**The maskable icon is a different drawing, not a resize.** Android crops adaptive icons to a circle inscribed in roughly the inner 80%, so that variant scales the mark to 50% of the canvas to keep the tick marks inside the safe zone. The standard icon sits at 64%. Using the standard file as a maskable one loses the ticks on most Android launchers.

## Sources — `design/brand/`

| File | Use it for |
| ---- | ---------- |
| `app-icon-source.svg` | Regenerating the standard icon at any size |
| `app-icon-android-maskable-source.svg` | Regenerating the maskable variant |

Never served and never imported. If a new icon size is needed, it is rendered from these and written into `public/icons/`.

## What not to do

- Do not redesign or recolour the mark. Do not recolour the arc.
- Do not add the wordmark to the mark where the mark is used alone.
- Do not move font files into `public/`. Serving them statically loses the hashing, preloading, and `@font-face` generation that `next/font/local` provides.
- Do not reproduce the Kalshi logo anywhere. Kalshi appears as text only.
- No team logos, helmet marks, or league imagery. Teams are three-letter text abbreviations.
