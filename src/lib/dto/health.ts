import type { HealthSignalState } from "@/lib/health/types";

/**
 * Health payloads are **display-ready strings computed server-side** (RD-28):
 * absolutes are ET-formatted, ages are compact (`5h 40m`), and the client
 * renders them verbatim with no clock math and no polling.
 *
 * Nothing here names a workflow, a token, a DSN, or a connection — the
 * surface reports product-level facts, not CI internals.
 */

export type HealthSourceDetailDto = {
  /** Dataset name from the cycle registry ("schedule", "weather", …). */
  name: string;
  required: boolean;
  state: "ok" | "degraded" | "failed";
  /** ET display string. Null when the source never finished. */
  finishedAt: string | null;
};

export type HealthGameDetailDto = {
  /** "12 of 14" — games whose recompute succeeded in the latest cycle. */
  currentCount: number;
  totalCount: number;
  lagging: Array<{
    /** Matchup, never a player: "CIN @ BAL". Per-contract currency lives on the slate. */
    label: string;
    /** Kickoff time, ET display string. */
    kickoffAt: string;
    reason: string;
  }>;
};

export type HealthSignalDto = {
  key: "ingest" | "recompute" | "price_refresh" | "outcome_ingest" | "grading";
  label: string;
  state: HealthSignalState;
  /** Absolute ET display string. Null when no successful run exists. */
  lastSuccessAt: string | null;
  /** Supplements the absolute value; never replaces it. */
  lastSuccessAge: string | null;
  /** Human sentence from configured bounds. Null when `not_expected`. */
  expectedWithin: string | null;
  /** Shown when it differs from the last success. */
  lastAttemptAt: string | null;
  lastAttemptOutcome: "succeeded" | "failed" | "incomplete" | "running" | null;
  /** Ingest only; present when any source in the latest cycle is non-ok. */
  sources?: HealthSourceDetailDto[];
  /** Recompute only; present when the latest cycle left games behind. */
  games?: HealthGameDetailDto;
  /**
   * Grading only: completed games holding eligible ungraded projections.
   * Zero renders nothing — absence is the healthy state. Admin-only by the
   * surface's existing gate; the shared accuracy payload never carries it.
   */
  awaitingGrades?: number;
};

export type HealthKeepaliveDto = {
  lastActedAt: string | null;
  lastActedAge: string | null;
  nextRequiredBy: string | null;
  overdue: boolean;
};

export type HealthDto = {
  signals: HealthSignalDto[];
  /** Non-null only when every signal is `not_expected` (offseason layout). */
  offseason: null | {
    dormantCopy: string;
    keepalive: HealthKeepaliveDto;
  };
};
