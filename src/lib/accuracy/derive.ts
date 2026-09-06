import type {
  Disposition,
  MarketSide,
  OutcomeResult,
} from "../../../generated/prisma/enums";
import type { OverrideDecisionRowDto } from "@/lib/dto/accuracy";
import type { OutcomeBlockDto } from "@/lib/dto/slate";

/**
 * Pure read-time derivations for override performance, timing cost, and the
 * outcome block — functions of already-stored snapshot and settlement facts,
 * so the orientation and taxonomy rules are testable without a database.
 *
 * Ground truth this module encodes (matching every snapshot write path —
 * `readSlate`, `snapshotForDecision`, `final-snapshot.ts`):
 *
 * - A snapshot's `modelProbability` is **P(yes)** — the model's P(≥ threshold)
 *   — regardless of the snapshot's `side`. The probability on any side is
 *   `side === "yes" ? p : 1 − p`.
 * - A snapshot's `edgePoints` is oriented to its own `side`:
 *   `p_side × 100 − ask_side`.
 * - Timing cost is **final-state edge minus decision-time edge, both oriented
 *   to the decision's side** — for a fade, the side he actually preferred
 *   (the opposite of the model's `snapshotSide`). Positive = the final
 *   pre-kickoff edge exceeded the edge he acted on: waiting would have been
 *   better. Never zero-filled: unavailability carries its reason.
 * - Skips have no position, no timing cost, and NO win/loss language.
 */

export type TimingUnavailableReason =
  OverrideDecisionRowDto["timingUnavailableReason"];

export type FinalSnapshotFacts = {
  side: MarketSide | null;
  /** The model's P(yes) as stored on the snapshot. */
  modelProbability: number | null;
  /** Edge in points on the snapshot's own `side`. */
  edgePoints: number | null;
  yesAskCents: number | null;
  noAskCents: number | null;
};

export function oppositeSide(side: MarketSide): MarketSide {
  return side === "yes" ? "no" : "yes";
}

/**
 * The side a decision's figures orient to: the model's side for a take (and
 * for a skip, where the figures describe the state he declined to act on),
 * the opposite — the side he preferred — for a fade.
 */
export function orientationSide(
  disposition: Disposition,
  snapshotSide: MarketSide | null,
): MarketSide | null {
  if (snapshotSide === null) return null;
  return disposition === "faded" ? oppositeSide(snapshotSide) : snapshotSide;
}

/** Edge in points for `side` from P(yes) and that side's executable ask. */
export function edgeForSide(
  side: MarketSide,
  pYes: number | null,
  yesAskCents: number | null,
  noAskCents: number | null,
): number | null {
  if (pYes === null) return null;
  const ask = side === "yes" ? yesAskCents : noAskCents;
  if (ask === null) return null;
  const p = side === "yes" ? pYes : 1 - pYes;
  return round2(p * 100 - ask);
}

/**
 * The final-state edge on `side`. When the final snapshot's own side matches,
 * its stored `edgePoints` is exactly this quantity; otherwise it is derived
 * from the snapshot's linked price observation and stored P(yes). Null when
 * the needed book side or probability is unavailable — never zero.
 */
export function finalEdgeForSide(
  side: MarketSide,
  final: FinalSnapshotFacts,
): number | null {
  if (final.side === side && final.edgePoints !== null) {
    return final.edgePoints;
  }
  return edgeForSide(
    side,
    final.modelProbability,
    final.yesAskCents,
    final.noAskCents,
  );
}

export type DecisionTimingInput = {
  disposition: Disposition;
  /** The model's side at decision time, as stored on the decision. */
  snapshotSide: MarketSide | null;
  /** Stored decision-time edge, oriented to `snapshotSide`. */
  snapshotEdgePoints: number | null;
  /** The model's P(yes) at decision time, as stored on the decision. */
  snapshotModelProbability: number | null;
  /** Both asks from the decision's linked price observation. */
  decisionYesAskCents: number | null;
  decisionNoAskCents: number | null;
  final: FinalSnapshotFacts | null;
  outcomeResult: OutcomeResult | null;
};

export type DecisionTiming = {
  edgeAtDecision: number | null;
  edgeAtFinal: number | null;
  timingCostPoints: number | null;
  timingUnavailableReason: TimingUnavailableReason;
};

export function deriveDecisionTiming(
  input: DecisionTimingInput,
): DecisionTiming {
  const side = orientationSide(input.disposition, input.snapshotSide);

  // Decision-time edge on the decision's side. A take (and a skip's display)
  // uses the stored edge, which is already on the model's side; a fade must
  // derive the preferred side's edge from the decision's own observation.
  const edgeAtDecision =
    side === null
      ? null
      : input.disposition === "faded"
        ? edgeForSide(
            side,
            input.snapshotModelProbability,
            input.decisionYesAskCents,
            input.decisionNoAskCents,
          )
        : (input.snapshotEdgePoints ??
          edgeForSide(
            side,
            input.snapshotModelProbability,
            input.decisionYesAskCents,
            input.decisionNoAskCents,
          ));

  const edgeAtFinal =
    side !== null && input.final !== null
      ? finalEdgeForSide(side, input.final)
      : null;

  // A skip is no action: both edges are displayable context, but there is no
  // acted-on moment to cost, so it enters no timing denominator at all.
  if (input.disposition === "skipped") {
    return {
      edgeAtDecision,
      edgeAtFinal,
      timingCostPoints: null,
      timingUnavailableReason: null,
    };
  }

  if (input.outcomeResult === "voided") {
    return {
      edgeAtDecision,
      edgeAtFinal,
      timingCostPoints: null,
      timingUnavailableReason: "voided",
    };
  }
  if (input.final === null) {
    return {
      edgeAtDecision,
      edgeAtFinal: null,
      timingCostPoints: null,
      timingUnavailableReason: "missing_final_snapshot",
    };
  }
  if (side === null || edgeAtDecision === null || edgeAtFinal === null) {
    return {
      edgeAtDecision,
      edgeAtFinal,
      timingCostPoints: null,
      timingUnavailableReason: "side_unavailable",
    };
  }

  return {
    edgeAtDecision,
    edgeAtFinal,
    timingCostPoints: round2(edgeAtFinal - edgeAtDecision),
    timingUnavailableReason: null,
  };
}

/**
 * The settlement-graded outcome of one acted-on decision.
 *
 * A take wins when the model's side settled; a fade wins when the side he
 * preferred — the opposite — settled. A skip is no action and NEVER carries
 * win/loss language: settlement is described, not scored. A take or fade
 * recorded with no side (no projection at decision time) has no gradable
 * position either and falls back to the descriptive form.
 */
export function decisionOutcome(
  disposition: Disposition,
  snapshotSide: MarketSide | null,
  result: OutcomeResult | null,
): OverrideDecisionRowDto["outcome"] {
  if (result === null) return "pending";
  if (result === "voided") return "voided";
  const positionSide =
    disposition === "skipped"
      ? null
      : orientationSide(disposition, snapshotSide);
  if (positionSide === null) {
    return result === "yes" ? "settled_yes" : "settled_no";
  }
  return positionSide === result ? "won" : "lost";
}

/**
 * Recommendation correctness per the final pre-kickoff snapshot — decision 16:
 * no final snapshot means explicitly unavailable, never graded against a
 * substitute. Null only when a final snapshot exists but recorded no side
 * (inputs had vanished): there was no recommendation state to grade.
 */
export function recommendationGrade(
  final: { side: MarketSide | null } | null,
  result: OutcomeResult | null,
): OutcomeBlockDto["recommendationGrade"] {
  if (result === "voided") return "voided";
  if (final === null) return "missing_final_snapshot";
  if (result === null) return "pending";
  if (final.side === null) return null;
  return final.side === result ? "correct" : "incorrect";
}

/**
 * The two truths disagreeing: the official line implies one side of the
 * threshold, the settlement the other. Flagged only when BOTH are present;
 * both values stay displayed, nothing is reconciled.
 */
export function sourcesDisagree(
  officialImpliesYes: boolean | null,
  result: OutcomeResult | null,
): boolean {
  if (officialImpliesYes === null) return false;
  if (result !== "yes" && result !== "no") return false;
  return officialImpliesYes !== (result === "yes");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
