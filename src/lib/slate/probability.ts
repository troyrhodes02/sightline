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
export const KIND_EMPIRICAL_QUANTILES = "empirical_quantiles";
export const KIND_EMPIRICAL_PMF = "empirical_pmf";

/**
 * The fixed percentile grid the Simulation Engine stores continuous stats on
 * (`simulation/config.py::QUANTILE_GRID`). Keys are `q01..q99`. Kept in lockstep
 * with Python: the golden-parity fixture is generated from the Python
 * `prob_at_least_from_quantiles`, so any drift here fails that test.
 */
const QUANTILE_GRID = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
const QUANTILE_KEYS = QUANTILE_GRID.map(
  (q) => `q${String(Math.round(q * 100)).padStart(2, "0")}`,
);

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
  /** ZIL: { p_zero, mu, sigma }. NB: { r, p }. Empirical kinds: inspection-only. */
  params: Record<string, number>;
  /**
   * Count families (`negative_binomial`, `empirical_pmf`): P(X = k) for
   * k = 0..K plus one aggregated (K+1)+ tail bucket in the last slot.
   */
  pmf: number[] | null;
  /**
   * Continuous empirical (`empirical_quantiles`): the stored 9-point grid keyed
   * `q01..q99`. Absent for the analytic and count families.
   */
  quantiles?: Record<string, number> | null;
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

  if (distribution.distributionKind === KIND_EMPIRICAL_QUANTILES) {
    return probAtLeastFromQuantiles(distribution.quantiles ?? null, threshold);
  }

  if (distribution.distributionKind === KIND_EMPIRICAL_PMF) {
    return probAtLeastFromPmf(distribution.pmf, threshold);
  }

  return null;
}

/**
 * `P(X >= t)` for the empirical quantile grid — the exact twin of
 * `sightline_model/simulation/core.py::prob_at_least_from_quantiles`.
 *
 * Builds the implied CDF from the stored `(percentile, value)` points and
 * returns `1 - CDF(t)` by monotone piecewise-linear interpolation between the
 * two bracketing points. At or below the lowest stored value the CDF clamps
 * toward 0 (value floor 0 for non-negative stats); at or above the highest it
 * clamps toward 1. Non-strictly-increasing grids are nudged to strict
 * monotonicity first, so the interpolation is well defined on ties.
 */
export function probAtLeastFromQuantiles(
  quantiles: Record<string, number> | null,
  threshold: number,
): number | null {
  if (!quantiles) return null;
  const percentiles = QUANTILE_GRID.slice();
  const values: number[] = [];
  for (const key of QUANTILE_KEYS) {
    const value = quantiles[key];
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  // Nudge to strictly increasing so the linear interpolation is well defined.
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] <= values[i - 1]) values[i] = values[i - 1] + 1e-9;
  }

  let cdf: number;
  if (threshold <= values[0]) {
    cdf = threshold >= values[0] ? percentiles[0] : 0;
  } else if (threshold >= values[values.length - 1]) {
    cdf = 1;
  } else {
    cdf = interp(threshold, values, percentiles);
  }
  return Math.min(Math.max(1 - cdf, 0), 1);
}

/**
 * `P(X >= t)` for the explicit PMF — the twin of
 * `core.py::prob_at_least_from_pmf`. Sums the mass at indices `>= ceil(t)`. The
 * tail bucket (last index, `(K+1)+`) contributes fully to any threshold at or
 * before it. Kalshi count thresholds are `.5` values, so `ceil` maps `k.5` to
 * `k + 1` and never ties an integer support point.
 */
export function probAtLeastFromPmf(
  pmf: number[] | null,
  threshold: number,
): number | null {
  if (!pmf || pmf.length === 0) return null;
  const k = Math.ceil(threshold);
  if (k <= 0) return 1;
  if (k >= pmf.length) {
    // At/above the tail-bucket index: only the tail mass clears it.
    return k === pmf.length - 1 ? pmf[pmf.length - 1] : 0;
  }
  let sum = 0;
  for (let i = k; i < pmf.length; i += 1) sum += pmf[i];
  return sum;
}

/**
 * `numpy.interp` for a monotone-increasing x-grid: linear interpolation of `ys`
 * at `x`, matching NumPy's default (and Python's `prob_at_least_from_quantiles`)
 * so the two runtimes agree to golden tolerance.
 */
function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let hi = 1;
  while (hi < last && xs[hi] < x) hi += 1;
  const lo = hi - 1;
  const span = xs[hi] - xs[lo];
  if (span === 0) return ys[lo];
  const t = (x - xs[lo]) / span;
  return ys[lo] + t * (ys[hi] - ys[lo]);
}
