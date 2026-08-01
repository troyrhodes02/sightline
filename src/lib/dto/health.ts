import type { HealthSignalState } from "@/lib/health/types";

export type HealthSignalDto = {
  key: "ingest" | "recompute" | "price_refresh";
  label: string;
  state: HealthSignalState;
  /** Absolute, with a timezone. Null when no successful run exists. */
  lastSuccessAt: string | null;
  /** Supplements the absolute value; never replaces it. */
  lastSuccessAge: string | null;
  /** Populated from Pitch 5. */
  expectedWithin: string | null;
  /** Populated from Pitch 5. */
  lastAttemptAt: string | null;
};
