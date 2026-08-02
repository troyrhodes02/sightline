import {
  NumericText,
  type NumericSize,
} from "@/components/primitives/NumericText";

/**
 * "1,847 obs · 412 projections" — the atom of the accuracy surface.
 *
 * One primitive so the two-denominator rule cannot be half-applied: threshold
 * observations from one player distribution are correlated, so the projection
 * count is the effective sample and the pair always travels together.
 */
export function SampleSizePair({
  observations,
  projections,
  size = "sm",
  muted = true,
  abbreviate = false,
}: {
  observations: number;
  projections: number;
  size?: NumericSize;
  muted?: boolean;
  /** "proj" instead of "projections", for tight rows at `xs`. */
  abbreviate?: boolean;
}) {
  return (
    <NumericText size={size} muted={muted} component="span">
      {observations.toLocaleString("en-US")} obs ·{" "}
      {projections.toLocaleString("en-US")}{" "}
      {abbreviate ? "proj" : "projections"}
    </NumericText>
  );
}
