import { applyKnots, assertValidKnots, type RecalibrationKnots } from "./fit";

/**
 * Applying a stored recalibration to a raw threshold probability.
 *
 * Kept separate from `fit.ts` so the read path — which runs on every candidate
 * of every cycle — depends on interpolation and nothing else. Fitting reads
 * calibration history; applying reads one stored row.
 */

/** A fit as it comes back from the database, narrowed to what applying needs. */
export type ActiveRecalibration = {
  id: string;
  version: number;
  modelVersion: string;
  knots: RecalibrationKnots;
};

/**
 * Parses the stored `knots` JSON into the typed shape, rejecting anything
 * malformed rather than interpolating over it.
 *
 * A corrupt fit must fail loudly. The alternative — silently falling back to
 * the raw probability — would size from an uncorrected number, which is the
 * pitch's first No-Go, and it would do so invisibly.
 */
export function parseKnots(value: unknown): RecalibrationKnots {
  if (!Array.isArray(value)) {
    throw new Error("recalibration knots must be an array");
  }
  const knots: RecalibrationKnots = value.map((entry, index) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "number" ||
      typeof entry[1] !== "number" ||
      !Number.isFinite(entry[0]) ||
      !Number.isFinite(entry[1])
    ) {
      throw new Error(`recalibration knot ${index} is not a [number, number]`);
    }
    return [entry[0], entry[1]];
  });
  assertValidKnots(knots);
  return knots;
}

/**
 * The corrected probability sizing consumes.
 *
 * Returns `null` when the raw probability is null — "could not price this" and
 * "priced it at zero" are different states, and collapsing them here would put
 * a zero into a Kelly calculation that should never have run.
 */
export function correctedProbability(
  fit: ActiveRecalibration,
  rawProbability: number | null,
): number | null {
  if (rawProbability === null) return null;
  return applyKnots(fit.knots, rawProbability);
}

/**
 * Whether a stored fit governs a given model version.
 *
 * A fit is fitted against one model's calibration record and means nothing
 * about another's. A projection from a model version with no active fit is
 * refused (`no_active_recalibration`) rather than corrected by a neighbour's
 * map — the whole reason the correction exists is that this model's error is
 * measured, and a different model's measurement is not evidence about it.
 */
export function fitGoverns(
  fit: ActiveRecalibration,
  modelVersion: string,
): boolean {
  return fit.modelVersion === modelVersion;
}
