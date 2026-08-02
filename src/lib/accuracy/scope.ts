import { StatType } from "../../../generated/prisma/enums";
import type { AccuracyScope } from "@/lib/dto/accuracy";

/**
 * Scope parsing for `/accuracy` query params.
 *
 * The URL is user-editable input, not a form: an unrecognized value falls back
 * to that control's default silently, never an error (spec §11). Two of the
 * five controls can only be finished against the database — the season list
 * and the version list are "values with graded data", and "latest deployed"
 * is a query — so the parser produces a request and `readAccuracy` resolves
 * it into the final `AccuracyScope` the DTO carries.
 */

export type AccuracyScopeRequest = {
  record: AccuracyScope["record"];
  population: AccuracyScope["population"];
  statType: AccuracyScope["statType"];
  /** Validated against seasons with graded data by the read. */
  season: number | "all";
  /**
   * `null` means "not requested": the read resolves it to the latest deployed
   * version with graded data (the default), or `"all"` when nothing is graded.
   */
  modelVersion: string | "all" | null;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const RECORDS = new Set<AccuracyScope["record"]>([
  "live",
  "backtest",
  "compare",
]);
const POPULATIONS = new Set<AccuracyScope["population"]>([
  "contract_like",
  "all",
  "market_linked",
]);
const STAT_TYPES = new Set<string>(Object.values(StatType));

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAccuracyScope(params: SearchParams): AccuracyScopeRequest {
  const record = first(params.record);
  const population = first(params.population);
  const stat = first(params.stat);
  const season = first(params.season);
  const version = first(params.version);

  return {
    record: RECORDS.has(record as AccuracyScope["record"])
      ? (record as AccuracyScope["record"])
      : "live",
    population: POPULATIONS.has(population as AccuracyScope["population"])
      ? (population as AccuracyScope["population"])
      : "contract_like",
    statType: stat && STAT_TYPES.has(stat) ? (stat as StatType) : "all",
    season: season && /^\d{4}$/.test(season) ? Number(season) : "all",
    modelVersion: version === "all" ? "all" : version ? version : null,
  };
}
