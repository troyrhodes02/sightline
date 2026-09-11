import {
  BACKTEST_SAMPLE_FLOOR,
  BASELINE_VERSION,
  EVIDENCE_MODERATE_MULTIPLE,
  EVIDENCE_STRONG_MULTIPLE,
  LEADER_BRIER_MARGIN,
  LIVE_SAMPLE_FLOOR,
  SIMULATION_VERSION,
} from "./config";
import type {
  EvidenceRecord,
  EvidenceStrength,
  LeaderState,
  ModelRecommendationDto,
} from "@/lib/dto/model-eval";

/**
 * The leader / recommendation layer — pure, database-free (spec D1/D14).
 *
 * Everything here is a function of already-computed Briers and sample counts,
 * so the four-state closed vocabulary, the margin bar, and the sample floors
 * are testable at their exact boundaries without a database. Nothing in this
 * module reads a price, a fit, or a config, and nothing writes anything — the
 * recommendation is decision support, structurally incapable of activating
 * itself (D12).
 */

/** The applicable sample floor for a record (D1). */
export function sampleFloor(record: EvidenceRecord): number {
  return record === "live" ? LIVE_SAMPLE_FLOOR : BACKTEST_SAMPLE_FLOOR;
}

export type LeaderInput = {
  record: EvidenceRecord;
  baselineBrier: number | null;
  simulationBrier: number | null;
  /** Sample size in the record's own population (deduped for live — D3). */
  sampleSize: number;
};

export type LeaderResult = {
  leader: LeaderState;
  /** abs(baseline − simulation); null when a side is empty. */
  brierMargin: number | null;
};

/**
 * Resolves the leader for one record + population (D1).
 *
 * Order matters and is deliberate: the sample floor is checked FIRST, so a
 * large margin on a thin sample is `not_enough_evidence`, never a leader. Only
 * once the sample clears its floor does the margin decide between a leader and
 * `too_close_to_call`. A margin of exactly `LEADER_BRIER_MARGIN` leads (the bar
 * is inclusive); a sample of exactly the floor is sufficient.
 */
export function determineLeader(input: LeaderInput): LeaderResult {
  const { baselineBrier, simulationBrier } = input;
  const margin =
    baselineBrier === null || simulationBrier === null
      ? null
      : Math.abs(baselineBrier - simulationBrier);

  // Sample below floor OR a side with no evidence at all → not enough evidence,
  // regardless of any margin. A null Brier means that model has no comparable
  // observations, which is itself insufficient evidence.
  if (input.sampleSize < sampleFloor(input.record) || margin === null) {
    return { leader: "not_enough_evidence", brierMargin: margin };
  }

  // The bar is inclusive (margin ≥ 0.01 leads). A small epsilon absorbs
  // floating-point error so a margin that is 0.01 in exact arithmetic — e.g.
  // 0.21 − 0.20, which evaluates to 0.00999999… — is not demoted to
  // too_close_to_call by representation noise.
  if (margin < LEADER_BRIER_MARGIN - 1e-9) {
    return { leader: "too_close_to_call", brierMargin: margin };
  }

  // Lower Brier is better. Ties above the bar are impossible (margin ≥ bar > 0).
  return {
    leader:
      (simulationBrier as number) < (baselineBrier as number)
        ? "simulation_leads"
        : "baseline_leads",
    brierMargin: margin,
  };
}

/**
 * Evidence strength for a sample within a record (design doc). Below the
 * record's floor is always `limited`; the moderate/strong bands are floor
 * multiples so they scale with the record rather than adding new constants.
 */
export function evidenceStrength(
  record: EvidenceRecord,
  sampleSize: number,
): EvidenceStrength {
  const floor = sampleFloor(record);
  if (sampleSize >= floor * EVIDENCE_STRONG_MULTIPLE) return "strong";
  if (sampleSize >= floor * EVIDENCE_MODERATE_MULTIPLE) return "moderate";
  return "limited";
}

/** True once the sample clears its record's floor (D1). */
export function belowFloor(
  record: EvidenceRecord,
  sampleSize: number,
): boolean {
  return sampleSize < sampleFloor(record);
}

const MODEL_NAMES: Record<string, string> = {
  [SIMULATION_VERSION]: "Simulation Engine",
  [BASELINE_VERSION]: "Baseline",
};

function modelName(modelVersion: string): string {
  return MODEL_NAMES[modelVersion] ?? "the leading model";
}

export type RecommendationInput = {
  /** The overall leader (contract-like, pooled across stats — D1). */
  leader: LeaderState;
  record: EvidenceRecord;
  brierMargin: number | null;
  sampleSize: number;
  baselineModelVersion: string;
  simulationModelVersion: string;
};

/**
 * The plain-language recommendation over the leader state and evidence strength
 * (D12). A pure function returning a DTO: it reads no database, resolves no
 * fit, and — by having no write path in scope — cannot mutate `ModelSelection`
 * or any config. The text is decision support the admin reads before making the
 * one human, confirmed selection that changes production config.
 *
 * The recommendation never *applies* itself: `recommendedModelVersion` names a
 * model to consider, and the accompanying UI offers no "apply" control.
 */
export function recommendation(
  input: RecommendationInput,
): ModelRecommendationDto {
  const recordLabel = input.record === "live" ? "live" : "backtest";
  const strength = evidenceStrength(input.record, input.sampleSize);

  if (input.leader === "not_enough_evidence") {
    return {
      leader: input.leader,
      canRecommend: false,
      recommendedModelVersion: null,
      text: `Not enough ${recordLabel} evidence yet to compare the models. Keep both engines accumulating; no model change is warranted.`,
    };
  }

  if (input.leader === "too_close_to_call") {
    const marginText =
      input.brierMargin === null
        ? ""
        : ` (Brier margin ${fmt(input.brierMargin)})`;
    return {
      leader: input.leader,
      canRecommend: false,
      recommendedModelVersion: null,
      text: `The models are too close to call on ${recordLabel} evidence${marginText}. Neither is clearly better calibrated; no model change is warranted on this evidence.`,
    };
  }

  const leadingVersion =
    input.leader === "simulation_leads"
      ? input.simulationModelVersion
      : input.baselineModelVersion;
  const marginText =
    input.brierMargin === null ? "" : `by ${fmt(input.brierMargin)} Brier `;
  const strengthText =
    strength === "strong"
      ? "on strong"
      : strength === "moderate"
        ? "on moderate"
        : "on limited";

  return {
    leader: input.leader,
    canRecommend: strength !== "limited",
    recommendedModelVersion: leadingVersion,
    text: `${modelName(leadingVersion)} leads ${marginText}${strengthText} ${recordLabel} evidence (${input.sampleSize.toLocaleString("en-US")} observations). ${
      strength === "limited"
        ? "The sample is still thin — consider it directional, not decisive, before any human model selection."
        : "Consider selecting it in Paper Bot → Settings; the change is a human, confirmed action and never automatic."
    }`,
  };
}

function fmt(value: number): string {
  return value.toFixed(3);
}
