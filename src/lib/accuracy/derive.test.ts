import {
  decisionOutcome,
  deriveDecisionTiming,
  edgeForSide,
  finalEdgeForSide,
  orientationSide,
  recommendationGrade,
  sourcesDisagree,
  type DecisionTimingInput,
  type FinalSnapshotFacts,
} from "./derive";

/**
 * Timing-cost orientation and grading fixtures (spec §13.7). The sign
 * convention under attack: final minus decision, positive = waiting better,
 * on the DECISION's side — a fade orients to the side he preferred.
 */

const finalYes: FinalSnapshotFacts = {
  side: "yes",
  modelProbability: 0.62, // P(yes)
  edgePoints: 8.1, // 62 − 53.9 ≈ stored on yes
  yesAskCents: 54,
  noAskCents: 48,
};

function timing(overrides: Partial<DecisionTimingInput>): DecisionTimingInput {
  return {
    disposition: "took",
    snapshotSide: "yes",
    snapshotEdgePoints: 7.4,
    snapshotModelProbability: 0.6,
    decisionYesAskCents: 53,
    decisionNoAskCents: 49,
    final: finalYes,
    outcomeResult: "yes",
    ...overrides,
  };
}

describe("timing cost orientation", () => {
  it("took-yes with the final snapshot on the same side uses the stored final edge", () => {
    const result = deriveDecisionTiming(timing({}));
    expect(result.edgeAtDecision).toBe(7.4);
    expect(result.edgeAtFinal).toBe(8.1);
    // Final minus decision: the edge grew, waiting would have been better.
    expect(result.timingCostPoints).toBeCloseTo(0.7, 5);
    expect(result.timingUnavailableReason).toBeNull();
  });

  it("a shrinking edge costs negatively — acting early was better", () => {
    const result = deriveDecisionTiming(
      timing({ final: { ...finalYes, edgePoints: 5.0 } }),
    );
    expect(result.timingCostPoints).toBeCloseTo(-2.4, 5);
  });

  it("a fade orients BOTH edges to the side he preferred", () => {
    // Model liked yes at decision (P(yes)=0.6) and at final (P(yes)=0.62);
    // he preferred no. Decision-time edge on no: (1−0.6)×100 − 49 = −9.
    // Final edge on no: (1−0.62)×100 − 48 = −10 — derived from the final
    // snapshot's linked observation, never the stored yes-side edge.
    const result = deriveDecisionTiming(timing({ disposition: "faded" }));
    expect(result.edgeAtDecision).toBeCloseTo(-9, 5);
    expect(result.edgeAtFinal).toBeCloseTo(-10, 5);
    expect(result.timingCostPoints).toBeCloseTo(-1, 5);
    expect(result.timingUnavailableReason).toBeNull();
  });

  it("no final snapshot: unavailable with its reason, never zero", () => {
    const result = deriveDecisionTiming(timing({ final: null }));
    expect(result.edgeAtDecision).toBe(7.4);
    expect(result.edgeAtFinal).toBeNull();
    expect(result.timingCostPoints).toBeNull();
    expect(result.timingUnavailableReason).toBe("missing_final_snapshot");
  });

  it("the needed book side missing at final: side_unavailable, never zero", () => {
    // Decision preferred no (fade); the final observation has no no-ask.
    const result = deriveDecisionTiming(
      timing({
        disposition: "faded",
        final: { ...finalYes, noAskCents: null },
      }),
    );
    expect(result.timingCostPoints).toBeNull();
    expect(result.timingUnavailableReason).toBe("side_unavailable");
  });

  it("a decision with no side has no orientation: side_unavailable", () => {
    const result = deriveDecisionTiming(
      timing({ snapshotSide: null, snapshotEdgePoints: null }),
    );
    expect(result.edgeAtDecision).toBeNull();
    expect(result.timingCostPoints).toBeNull();
    expect(result.timingUnavailableReason).toBe("side_unavailable");
  });

  it("voided outrules every other reason and never enters the measurable set", () => {
    const result = deriveDecisionTiming(
      timing({ outcomeResult: "voided", final: null }),
    );
    expect(result.timingCostPoints).toBeNull();
    expect(result.timingUnavailableReason).toBe("voided");
  });

  it("a skip has no timing cost and no unavailable reason — it is no action", () => {
    const result = deriveDecisionTiming(timing({ disposition: "skipped" }));
    // The edges remain displayable context, oriented to the model's side.
    expect(result.edgeAtDecision).toBe(7.4);
    expect(result.edgeAtFinal).toBe(8.1);
    expect(result.timingCostPoints).toBeNull();
    expect(result.timingUnavailableReason).toBeNull();
  });

  it("a pending settlement does not block timing — both snapshots exist pre-kickoff", () => {
    const result = deriveDecisionTiming(timing({ outcomeResult: null }));
    expect(result.timingCostPoints).toBeCloseTo(0.7, 5);
  });
});

describe("side arithmetic", () => {
  it("orients a fade to the opposite side and everything else to the model's", () => {
    expect(orientationSide("took", "yes")).toBe("yes");
    expect(orientationSide("skipped", "no")).toBe("no");
    expect(orientationSide("faded", "yes")).toBe("no");
    expect(orientationSide("faded", "no")).toBe("yes");
    expect(orientationSide("took", null)).toBeNull();
  });

  it("edgeForSide uses P(yes) and the side's own executable ask", () => {
    expect(edgeForSide("yes", 0.6, 54, 48)).toBeCloseTo(6, 5);
    expect(edgeForSide("no", 0.6, 54, 48)).toBeCloseTo(-8, 5);
    expect(edgeForSide("yes", null, 54, 48)).toBeNull();
    expect(edgeForSide("no", 0.6, 54, null)).toBeNull();
  });

  it("finalEdgeForSide prefers the stored edge only when the sides match", () => {
    expect(finalEdgeForSide("yes", finalYes)).toBe(8.1);
    expect(finalEdgeForSide("no", finalYes)).toBeCloseTo(-10, 5);
    // Stored edge missing on a matching side: derived, not zero.
    expect(
      finalEdgeForSide("yes", { ...finalYes, edgePoints: null }),
    ).toBeCloseTo(8, 5);
  });
});

describe("decision outcomes", () => {
  it("a take wins with the model's side and loses against it", () => {
    expect(decisionOutcome("took", "yes", "yes")).toBe("won");
    expect(decisionOutcome("took", "yes", "no")).toBe("lost");
    expect(decisionOutcome("took", "no", "no")).toBe("won");
  });

  it("a fade wins on the side he preferred — the opposite of the model's", () => {
    expect(decisionOutcome("faded", "yes", "no")).toBe("won");
    expect(decisionOutcome("faded", "yes", "yes")).toBe("lost");
    expect(decisionOutcome("faded", "no", "yes")).toBe("won");
  });

  it("a skip NEVER carries win/loss language — settlement is descriptive", () => {
    expect(decisionOutcome("skipped", "yes", "yes")).toBe("settled_yes");
    expect(decisionOutcome("skipped", "yes", "no")).toBe("settled_no");
    expect(decisionOutcome("skipped", null, "yes")).toBe("settled_yes");
  });

  it("voided and pending are their own states, in no win/loss denominator", () => {
    expect(decisionOutcome("took", "yes", "voided")).toBe("voided");
    expect(decisionOutcome("skipped", "yes", "voided")).toBe("voided");
    expect(decisionOutcome("faded", "yes", null)).toBe("pending");
  });

  it("a sideless take falls back to the descriptive form, never a fabricated grade", () => {
    expect(decisionOutcome("took", null, "yes")).toBe("settled_yes");
    expect(decisionOutcome("faded", null, "no")).toBe("settled_no");
  });
});

describe("recommendation grade", () => {
  it("grades the final snapshot's side against settlement", () => {
    expect(recommendationGrade({ side: "yes" }, "yes")).toBe("correct");
    expect(recommendationGrade({ side: "yes" }, "no")).toBe("incorrect");
    expect(recommendationGrade({ side: "no" }, "no")).toBe("correct");
  });

  it("is explicitly unavailable without a final snapshot — no substitute", () => {
    expect(recommendationGrade(null, "yes")).toBe("missing_final_snapshot");
  });

  it("voided and pending precede grading", () => {
    expect(recommendationGrade({ side: "yes" }, "voided")).toBe("voided");
    expect(recommendationGrade({ side: "yes" }, null)).toBe("pending");
  });

  it("a final snapshot with no side has no recommendation to grade", () => {
    expect(recommendationGrade({ side: null }, "yes")).toBeNull();
  });
});

describe("sources disagree", () => {
  it("flags only when both truths are present and imply different sides", () => {
    expect(sourcesDisagree(true, "no")).toBe(true);
    expect(sourcesDisagree(false, "yes")).toBe(true);
    expect(sourcesDisagree(true, "yes")).toBe(false);
    expect(sourcesDisagree(false, "no")).toBe(false);
  });

  it("never flags on a missing truth or a voided settlement", () => {
    expect(sourcesDisagree(null, "yes")).toBe(false);
    expect(sourcesDisagree(true, null)).toBe(false);
    expect(sourcesDisagree(true, "voided")).toBe(false);
  });
});
