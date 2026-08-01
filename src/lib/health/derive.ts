import type { HealthSignalState } from "./types";

/**
 * Pure health-state derivation (spec RD-25). No prisma, no env, no clock —
 * callers supply run records, schedule facts, bounds, and `now`, the same way
 * the staleness module takes its inputs. DB reads live in `read.ts`.
 *
 * Precedence: `not_expected` → `running` → `failed` → `late` → `never_run` →
 * `ok`. Notably `failed` outranks `late`: a signal whose latest attempt failed
 * reads `failed` even while its last success is still inside bounds, because
 * "the last cycle broke" is more actionable than "the numbers are old".
 */

/** One run attempt, normalized across `PipelineRun` and `MarketSyncRun`. */
export type AttemptRecord = {
  status: "running" | "succeeded" | "failed" | "incomplete";
  startedAt: Date;
  finishedAt: Date | null;
};

export type SignalInputs = {
  /** False when no scheduled game is inside the lookahead (offseason). */
  expected: boolean;
  /** Most recent attempt by start time, regardless of outcome. Null when none. */
  latestAttempt: AttemptRecord | null;
  /** Completion time of the most recent successful run. Null when none. */
  lastSuccessAt: Date | null;
  /** How old the last success may be before the signal is `late`. */
  lateAfterMs: number;
  /** A `running` attempt older than this reads as failed (abandoned). */
  runTimeoutMs: number;
  now: Date;
};

export function deriveSignalState(inputs: SignalInputs): HealthSignalState {
  // Dormant jobs are correct, not broken — and old timestamps under a dormant
  // signal are correct too, so nothing below is evaluated.
  if (!inputs.expected) return "not_expected";

  const attempt = inputs.latestAttempt;
  if (attempt?.status === "running") {
    const inFlightMs = inputs.now.getTime() - attempt.startedAt.getTime();
    // An abandoned `running` row never masquerades: past the timeout it reads
    // failed even before the next cycle rewrites it to `incomplete`.
    if (inFlightMs > inputs.runTimeoutMs) return "failed";
    return "running";
  }
  if (attempt?.status === "failed" || attempt?.status === "incomplete") {
    return "failed";
  }

  if (inputs.lastSuccessAt === null) return "never_run";

  const successAgeMs = inputs.now.getTime() - inputs.lastSuccessAt.getTime();
  return successAgeMs > inputs.lateAfterMs ? "late" : "ok";
}

/**
 * True when any scheduled kickoff lies inside `[now, now + lookaheadMs]`.
 * Both expectedness and the nightly workflow's own gate use this shape; the
 * stored schedule is the only calendar (RD-Q5).
 */
export function hasUpcomingKickoff(
  kickoffs: ReadonlyArray<Date>,
  now: Date,
  lookaheadMs: number,
): boolean {
  return kickoffs.some((k) => {
    const delta = k.getTime() - now.getTime();
    return delta >= 0 && delta <= lookaheadMs;
  });
}

/**
 * Game-day price cadence applies from each kickoff − window until that
 * kickoff ("first kickoff − 6h through last kickoff", RD-Q5). A game already
 * kicked off contributes nothing: Sightline is pre-game by design.
 */
export function isGamedayPriceWindow(
  kickoffs: ReadonlyArray<Date>,
  now: Date,
  windowMs: number,
): boolean {
  return kickoffs.some((k) => {
    const untilKickoffMs = k.getTime() - now.getTime();
    return untilKickoffMs >= 0 && untilKickoffMs <= windowMs;
  });
}

export type KeepaliveReadiness = {
  nextRequiredBy: Date | null;
  overdue: boolean;
};

/**
 * Keepalive readiness (RD-Q11). `nextRequiredBy` is last action + interval −
 * safety margin, so the amber turns on while there is still time to act
 * before GitHub's actual 60-day cutoff.
 *
 * With no keepalive ever recorded there is no anchor to compute from:
 * `nextRequiredBy` is null and `overdue` is false — the surface shows the
 * honest em dash for "last acted", and the pre-Week-1 runbook check covers
 * the never-run case rather than a permanently-amber first month.
 */
export function deriveKeepaliveReadiness(inputs: {
  lastActedAt: Date | null;
  intervalDays: number;
  safetyMarginDays: number;
  now: Date;
}): KeepaliveReadiness {
  if (inputs.lastActedAt === null) {
    return { nextRequiredBy: null, overdue: false };
  }
  const requiredWithinDays = inputs.intervalDays - inputs.safetyMarginDays;
  const nextRequiredBy = new Date(
    inputs.lastActedAt.getTime() + requiredWithinDays * 24 * 60 * 60_000,
  );
  return {
    nextRequiredBy,
    overdue: inputs.now.getTime() >= nextRequiredBy.getTime(),
  };
}
