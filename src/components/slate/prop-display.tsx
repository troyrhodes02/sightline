import type { PropDto } from "@/lib/dto/slate";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * Shared display vocabulary for props across the grouped Slate surfaces
 * (best-opportunities block, player card best line, threshold table). Kept in
 * one place so the three surfaces "speak the same visual language" (design doc
 * §9) and a stat label is never hand-typed twice.
 */

export const STAT_LABELS: Record<StatType, string> = {
  passing_yards: "Passing yds",
  rushing_yards: "Rushing yds",
  receiving_yards: "Receiving yds",
  receptions: "Receptions",
  rushing_tds: "Rushing TDs",
  receiving_tds: "Receiving TDs",
};

/** "Receiving yds ≥ 74.5" / "Rushing yds < 64.5" — the glyph carries direction. */
export function propTitle(statType: StatType, prop: PropDto): string {
  const glyph = prop.direction === "above" ? "≥" : "<";
  return `${STAT_LABELS[statType]} ${glyph} ${prop.threshold}`;
}

/** The probability label with its direction glyph: "P(≥)" / "P(<)". */
export function probabilityGlyph(direction: PropDto["direction"]): string {
  return direction === "above" ? "P(≥)" : "P(<)";
}
