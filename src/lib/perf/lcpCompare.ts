/**
 * Slate LCP comparison — the pure gate math for the performance harness
 * (Pitch 10, SIG-91 report-only; SIG-99 flips the gate to enforcing).
 *
 * The Slate is measured against a fixed 300-contract fixture (RD-3). This
 * module holds only the arithmetic: how much the feature branch improved
 * Largest Contentful Paint against the committed pre-change baseline, and
 * whether that improvement clears the bar. It is deliberately dependency-free
 * and side-effect-free so it can be unit-tested without a browser, a database,
 * or the network — none of which are available where the number is captured.
 *
 * Lower LCP is better. "Improvement" is a reduction in milliseconds.
 */

/** The required improvement bar for the enforcing gate (RD-3). */
export const REQUIRED_LCP_REDUCTION_PCT = 30;

export type LcpBaseline = {
  /** Whether `lcpMs` is a real measurement or a placeholder awaiting CI capture. */
  measured: boolean;
  /** Baseline LCP in milliseconds. Meaningful only when `measured` is true. */
  lcpMs: number | null;
  /** The commit the baseline was captured on, for provenance. */
  commit: string | null;
  note?: string;
};

export type LcpComparison = {
  baselineMs: number;
  currentMs: number;
  /** Positive means the current branch is faster than the baseline. */
  reductionPct: number;
  requiredPct: number;
  passes: boolean;
};

/**
 * Percent reduction from `baselineMs` to `currentMs`. Positive when the current
 * measurement is faster (lower) than the baseline; negative when it regressed.
 */
export function percentReduction(
  baselineMs: number,
  currentMs: number,
): number {
  if (!(baselineMs > 0)) {
    throw new Error("baselineMs must be a positive number of milliseconds.");
  }
  if (!(currentMs >= 0)) {
    throw new Error("currentMs must be a non-negative number of milliseconds.");
  }
  return ((baselineMs - currentMs) / baselineMs) * 100;
}

/**
 * Compare a current LCP against the baseline and decide whether it clears the
 * required reduction. `minReductionPct` defaults to the RD-3 bar.
 */
export function compareLcp(
  baselineMs: number,
  currentMs: number,
  minReductionPct: number = REQUIRED_LCP_REDUCTION_PCT,
): LcpComparison {
  const reductionPct = percentReduction(baselineMs, currentMs);
  return {
    baselineMs,
    currentMs,
    reductionPct,
    requiredPct: minReductionPct,
    // A tiny epsilon so a measurement landing exactly on the bar counts as passing.
    passes: reductionPct + 1e-9 >= minReductionPct,
  };
}

/**
 * Whether a comparison can even be run: both numbers present, and the baseline
 * is a real measurement rather than a placeholder. Returns the reason it cannot
 * run so the caller can report honestly instead of inventing a verdict.
 */
export function comparabilityReason(
  baseline: LcpBaseline,
  currentMs: number | null,
): { comparable: boolean; reason: string | null } {
  if (!baseline.measured || baseline.lcpMs === null) {
    return {
      comparable: false,
      reason:
        "baseline is a placeholder — capture it in CI on the pre-change commit first",
    };
  }
  if (currentMs === null) {
    return {
      comparable: false,
      reason: "no current LCP measurement was captured",
    };
  }
  return { comparable: true, reason: null };
}
