# Space Grotesk

One variable font, one file, covering weights 300–700. The type scale uses 400
(body and every data value), 500 (labels and column headers), and 600 (screen
titles only).

`SpaceGrotesk-Variable.woff2` — WOFF2 rather than TTF, which is roughly a
quarter the size over the wire and the right format for self-hosting.

## Tabular figures are load-bearing here

Space Grotesk's **default figures are proportional** — its ten digits have nine
different advance widths. Column alignment down a long slate therefore depends
entirely on `font-variant-numeric: tabular-nums`, which the theme sets on every
numeric variant.

With IBM Plex Mono this was belt and braces; with a proportional face it is the
only mechanism. Removing it silently breaks every numeric column in the product,
and nothing else will catch it.

`OFL.txt` is the SIL Open Font License. It stays with the font.
