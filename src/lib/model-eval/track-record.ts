import "server-only";

import { prisma } from "@/lib/prisma";
import { evidenceStrength } from "./leader";
import { TRACK_RECORD_BUCKET_FLOOR } from "./config";
import type { ContractTrackRecordDto } from "@/lib/dto/model-eval";
import type { Confidence, StatType } from "../../../generated/prisma/enums";

/**
 * The viewer-facing contract track-record read (PME-7, spec §UI data contracts,
 * D8/D18/D22). Returns the ONLY model-quality payload a viewer ever receives —
 * and, by design, the identical payload the admin receives on this shared
 * surface (D18); the richer comparison lives on Model Performance, never here.
 *
 * **Viewer-safety is structural, not filtered.** This function reads exactly one
 * thing: the ACTIVE production model's own graded record for this stat. It never
 * queries a second model version, a shadow projection, a paper ledger, a leader
 * comparison, or a decision. There is no `role` branch that adds fields — the
 * `role` parameter exists only to satisfy the spec's role-selected-serializer
 * shape and to make the surface auditable; both roles get the same object. A
 * viewer therefore cannot infer that a second engine runs (D22): nothing in the
 * payload, and nothing in the queries behind it, names one.
 *
 * **The graded record is the same one the admin surface reads.** The bucket rate
 * comes from `threshold_grades` — the exact table `readAccuracy`'s live series
 * groups over — filtered to this stat and the contract's active model version.
 * The 30-observation display floor (D8) is applied here: below it, the observed
 * rate is `null` (distinct from a real 0) and the component states plainly there
 * is not enough evidence yet, with the running count.
 *
 * The caller passes the already-resolved active-model projection facts
 * (`modelProbability`, `confidence`, `statType`, `modelVersion`) from the
 * contract detail it just read, so the block can never disagree with the
 * headline about which model priced this contract or what it said. When there is
 * no active-model projection (`modelProbability`/`modelVersion` null), or no
 * graded evidence exists for the stat yet, the read returns `null` and the
 * component renders the honest "building" state with the count so far.
 */
export async function readContractTrackRecord(
  input: {
    statType: StatType;
    modelVersion: string | null;
    modelProbability: number | null;
    confidence: Confidence | null;
  },
  // Present for the role-selected-serializer shape; both roles receive the same
  // viewer-safe payload — there is no admin-only field to add (D18).
  _role: "admin" | "viewer",
): Promise<ContractTrackRecordDto | null> {
  const { statType, modelVersion, modelProbability, confidence } = input;

  // No active-model projection for this contract → nothing to interpret. The
  // component distinguishes this from "building" via the stat-level count.
  if (
    modelVersion === null ||
    modelProbability === null ||
    confidence === null
  ) {
    return null;
  }

  // The displayed probability's fixed-tenth bucket, matching the accuracy
  // surface's binning exactly (least(floor(p*10), 9)) so the two surfaces name
  // the same bucket. 0.74 → bin 7 → "70–80%".
  const binIndex = Math.min(Math.floor(modelProbability * 10), 9);
  const rangeLabel = `${binIndex * 10}–${(binIndex + 1) * 10}%`;

  // The bucket's graded record for THIS stat under the contract's ACTIVE model
  // version — the same `threshold_grades` rows the admin live series groups.
  // One narrow aggregate row, computed in the database.
  const bucket = await prisma.$queryRaw<
    Array<{ observations: number; observed_rate: number | null }>
  >`
    SELECT
      count(*)::int AS observations,
      avg(CASE WHEN tg.outcome THEN 1.0 ELSE 0.0 END)::float8 AS observed_rate
    FROM threshold_grades tg
    JOIN projections p ON p.id = tg.projection_id
    WHERE p.stat_type::text = ${statType}::text
      AND p.model_version = ${modelVersion}
      AND least(floor(tg.stated_probability * 10), 9)::int = ${binIndex}::int`;

  // Pooled graded observations for the stat under the active model — the
  // stat-type track record's sample. Live + backtest evidence both flow through
  // `threshold_grades` (live grades and stored backtest grades alike), so this
  // one count is the pooled evidence the label's strength scales with.
  const statTotal = await prisma.$queryRaw<Array<{ observations: number }>>`
    SELECT count(*)::int AS observations
    FROM threshold_grades tg
    JOIN projections p ON p.id = tg.projection_id
    WHERE p.stat_type::text = ${statType}::text
      AND p.model_version = ${modelVersion}`;

  const statObservations = statTotal[0]?.observations ?? 0;

  // No graded evidence at all for this stat yet → "building". The component
  // renders the running count (which is 0 here), never a fabricated rate.
  if (statObservations === 0) return null;

  const rangeSampleSize = bucket[0]?.observations ?? 0;
  const belowFloor = rangeSampleSize < TRACK_RECORD_BUCKET_FLOOR;

  return {
    modelProbability,
    confidence,
    statType,
    rangeLabel,
    // Below the display floor the rate is withheld (null), never a small-n
    // number (D8). Above it, the observed frequency in the bucket.
    rangeObservedRate: belowFloor ? null : (bucket[0]?.observed_rate ?? null),
    rangeSampleSize,
    // The stat-type track-record label scales with the pooled graded evidence.
    // It may read `limited` even when the bucket is below its display floor —
    // the label is a qualitative strength, not a bucket rate.
    trackRecord: evidenceStrength("backtest", statObservations),
    statObservations,
    belowFloor,
  };
}
