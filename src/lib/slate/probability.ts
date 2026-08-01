/**
 * Threshold probability from a stored projection — the TypeScript half of the
 * cross-runtime contract with `sightline_model/distributions.py`.
 *
 * The Python engine stores a compact distribution (parameters for the
 * continuous family, an explicit PMF for counts); this module rehydrates
 * P(stat >= threshold) from those stored values with closed-form arithmetic.
 * No simulation, no refit — "adding a threshold costs an arithmetic call" is
 * the property the storage format exists to provide.
 *
 * Parity with Python is enforced by a golden-file test generated from the
 * actual Python distributions (`__fixtures__/probability-golden.json`). Any
 * change here or there must keep that file green.
 */

export const KIND_ZIL = "zero_inflated_lognormal";
export const KIND_NB = "negative_binomial";

/**
 * Complementary error function to near double precision — Maclaurin series
 * for small arguments, Lentz continued fraction for large. The same accuracy
 * class as the C-library erf Python's `NormalDist.cdf` sits on; a textbook
 * single-formula approximation (~1e-7) would fail golden parity at 1e-9.
 */
const INV_SQRT_PI = 1 / Math.sqrt(Math.PI);

/** erf via its Maclaurin series; excellent for |x| < 2. */
function erfSeries(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 80; n += 1) {
    term *= -x2 / n;
    const contribution = term / (2 * n + 1);
    sum += contribution;
    if (Math.abs(contribution) < 1e-18 * Math.abs(sum)) break;
  }
  return 2 * INV_SQRT_PI * sum;
}

/**
 * erfc via the standard continued fraction
 * `erfc(x) = e^(-x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …))))`,
 * evaluated with the modified Lentz algorithm; excellent for x ≥ 2.
 */
function erfcContinuedFraction(x: number): number {
  const tiny = 1e-300;
  let f = tiny;
  let c = f;
  let d = 0;
  for (let n = 0; n < 120; n += 1) {
    const a = n === 0 ? 1 : n / 2;
    const b = n % 2 === 0 ? x : x; // every denominator term is x in this CF form
    d = b + a * d;
    if (d === 0) d = tiny;
    c = b + a / c;
    if (c === 0) c = tiny;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-17) break;
  }
  return Math.exp(-x * x) * INV_SQRT_PI * f;
}

function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) return 1 - erfSeries(x);
  if (x > 27) return 0; // exp(-x²) underflows double precision
  return erfcContinuedFraction(x);
}

/** Standard normal CDF, matching Python's `statistics.NormalDist().cdf`. */
export function stdNormalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

export type StoredDistribution = {
  distributionKind: string;
  /** ZIL: { p_zero, mu, sigma }. NB: { r, p } (pmf carries the shape). */
  params: Record<string, number>;
  /** Present for count families; P(X = k) for k = 0..cap. */
  pmf: number[] | null;
};

/**
 * P(stat >= threshold) from stored values. Mirrors
 * `ZeroInflatedLogNormal.prob_at_least` and `NegativeBinomial.prob_at_least`
 * exactly. Returns null for an unknown kind — a future engine's projection
 * must read as "cannot derive" rather than as a wrong number.
 */
export function probAtLeast(
  distribution: StoredDistribution,
  threshold: number,
): number | null {
  if (distribution.distributionKind === KIND_ZIL) {
    const { p_zero, mu, sigma } = distribution.params;
    if (
      !Number.isFinite(p_zero) ||
      !Number.isFinite(mu) ||
      !Number.isFinite(sigma) ||
      sigma <= 0
    ) {
      return null;
    }
    if (threshold <= 0) return 1;
    const z = (Math.log(threshold) - mu) / sigma;
    return (1 - p_zero) * (1 - stdNormalCdf(z));
  }

  if (distribution.distributionKind === KIND_NB) {
    const pmf = distribution.pmf;
    if (!pmf || pmf.length === 0) return null;
    const k = Math.ceil(threshold);
    if (k <= 0) return 1;
    let below = 0;
    for (let i = 0; i < Math.min(k, pmf.length); i += 1) below += pmf[i];
    // Tail mass above the cap is never truncated away: 1 - below includes it,
    // exactly as the Python implementation's PMF-sum does.
    return 1 - below;
  }

  return null;
}
