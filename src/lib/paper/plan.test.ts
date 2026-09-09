import { PROBABILITY_CEILING, RISK_PRESETS } from "./config";
import { netPriceCents } from "./fees";
import {
  capacityCents,
  pastCutoff,
  planCycle,
  type CandidateInput,
  type CyclePlanInput,
} from "./plan";
import type { ActiveRecalibration } from "./recalibration/apply";

const KICKOFF = new Date("2026-11-02T18:00:00Z");
const NOW = new Date("2026-11-02T14:00:00Z"); // four hours out; inside the window

/** An identity correction, so tests exercise sizing rather than the fit. */
const IDENTITY: ActiveRecalibration = {
  id: "fit-1",
  version: 1,
  modelVersion: "baseline-v1",
  knots: [
    [0, 0],
    [1, 1],
  ],
};

function candidate(over: Partial<CandidateInput> = {}): CandidateInput {
  return {
    contractId: "c1",
    kalshiTicker: "KXNFLCHASE-26NOV02-74.5",
    projectionId: "p1",
    modelVersion: "baseline-v1",
    priceObservationId: "o1",
    rawYesProbability: 0.62,
    confidence: "high",
    staleness: {
      isStale: false,
      predatesInactives: false,
      inactivesExpectedAt: null,
    },
    yesAskCents: 54,
    noAskCents: 48,
    yesAskSizeContracts: 500,
    noAskSizeContracts: 500,
    ...over,
  };
}

function input(over: Partial<CyclePlanInput> = {}): CyclePlanInput {
  return {
    now: NOW,
    kickoffAt: KICKOFF,
    config: {
      mode: "conservative",
      ...RISK_PRESETS.conservative,
      probabilityCeiling: PROBABILITY_CEILING,
    },
    recalibration: IDENTITY,
    activeBankrollCents: 100_000,
    availableBankrollCents: 100_000,
    slateExposureCents: 0,
    gameExposureCents: 0,
    heldByContractId: {},
    candidates: [candidate()],
    haltingBreaches: [],
    ...over,
  };
}

describe("whole-cycle refusals", () => {
  it("skips at the ten-minute cutoff and creates nothing", () => {
    const plan = planCycle(
      input({ now: new Date(KICKOFF.getTime() - 9 * 60_000) }),
    );
    expect(plan.outcome).toBe("skipped");
    expect(plan.skipReason).toBe("pre_kickoff_cutoff");
    expect(plan.candidates.every((c) => c.verdict === "blocked")).toBe(true);
    expect(
      plan.candidates.every((c) => c.boundBy === "pre_kickoff_cutoff"),
    ).toBe(true);
    expect(plan.stakedCents).toBe(0);
  });

  it("applies the cutoff in aggressive mode exactly as in conservative", () => {
    // Aggressive means accepting more controlled bankroll risk. It does not
    // mean ignoring a timing safeguard.
    const plan = planCycle(
      input({
        now: new Date(KICKOFF.getTime() - 5 * 60_000),
        config: {
          mode: "aggressive",
          ...RISK_PRESETS.aggressive,
          probabilityCeiling: PROBABILITY_CEILING,
        },
      }),
    );
    expect(plan.outcome).toBe("skipped");
    expect(plan.skipReason).toBe("pre_kickoff_cutoff");
  });

  it("still runs at eleven minutes out", () => {
    const plan = planCycle(
      input({ now: new Date(KICKOFF.getTime() - 11 * 60_000) }),
    );
    expect(plan.outcome).not.toBe("skipped");
  });

  it("creates nothing when mark-to-market could not be computed", () => {
    // A safety check that cannot run is not a safety check. Refusing to stake
    // is the conservative direction.
    const plan = planCycle(input({ markToMarketUnavailable: true }));
    expect(plan.outcome).toBe("failed");
    expect(plan.skipReason).toBe("mark_to_market_unavailable");
    expect(plan.stakedCents).toBe(0);
  });

  it("blocks every candidate when a breaker is active, naming the condition", () => {
    const plan = planCycle(input({ haltingBreaches: ["drawdown_halt"] }));
    expect(plan.outcome).toBe("halted");
    expect(plan.candidates[0].verdict).toBe("blocked");
    expect(plan.candidates[0].boundBy).toBe("breaker");
    expect(plan.candidates[0].boundByDetail).toBe("drawdown_halt");
    expect(plan.stakedCents).toBe(0);
  });
});

describe("candidate eligibility", () => {
  it("refuses a stale projection", () => {
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            staleness: {
              isStale: true,
              predatesInactives: false,
              inactivesExpectedAt: null,
            },
          }),
        ],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("refused");
    expect(plan.candidates[0].boundBy).toBe("stale_projection");
  });

  it("refuses a projection that predates today's inactives", () => {
    // The second staleness state refuses too. It is a disclosure the slate
    // makes to a human who can weigh it; the bot cannot.
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            staleness: {
              isStale: false,
              predatesInactives: true,
              inactivesExpectedAt: "2026-11-02T16:30:00Z",
            },
          }),
        ],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("refused");
    expect(plan.candidates[0].boundBy).toBe("stale_projection");
    expect(plan.candidates[0].boundByDetail).toBe("predates today's inactives");
  });

  it("refuses when no fit governs the projection's model version", () => {
    // Sizing from a raw probability is a No-Go, so the only other option is to
    // refuse — and to say so by name.
    const plan = planCycle(input({ recalibration: null }));
    expect(plan.candidates[0].verdict).toBe("refused");
    expect(plan.candidates[0].boundBy).toBe("no_active_recalibration");

    const mismatched = planCycle(
      input({ candidates: [candidate({ modelVersion: "sim-v2" })] }),
    );
    expect(mismatched.candidates[0].boundBy).toBe("no_active_recalibration");
  });

  it("refuses a contract with no ask on either side", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskCents: null, noAskCents: null })],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("refused");
    expect(plan.candidates[0].boundBy).toBe("price_unavailable");
  });

  it("refuses rather than assuming depth when the book size cannot be read", () => {
    // The single most flattering assumption available. Unreadable depth is
    // refused; it is never defaulted to any number.
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            yesAskSizeContracts: null,
            noAskCents: null,
            noAskSizeContracts: null,
          }),
        ],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("refused");
    expect(plan.candidates[0].boundBy).toBe("price_unavailable");
    expect(plan.candidates[0].boundByDetail).toBe(
      "no displayed size at the executable price",
    );
    expect(plan.stakedCents).toBe(0);
  });
});

describe("economics", () => {
  it("stakes nothing above the probability ceiling", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ rawYesProbability: 0.82, noAskCents: null })],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("no_stake");
    expect(plan.candidates[0].boundBy).toBe("probability_ceiling");
  });

  it("keeps the ceiling identical across risk modes", () => {
    // Aggressive must not raise what Sightline considers trustworthy.
    for (const mode of ["conservative", "moderate", "aggressive"] as const) {
      const plan = planCycle(
        input({
          config: {
            mode,
            ...RISK_PRESETS[mode],
            probabilityCeiling: PROBABILITY_CEILING,
          },
          candidates: [
            candidate({ rawYesProbability: 0.82, noAskCents: null }),
          ],
        }),
      );
      expect(plan.candidates[0].boundBy).toBe("probability_ceiling");
    }
  });

  it("stakes nothing when the edge disappears after fees", () => {
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            rawYesProbability: 0.52,
            yesAskCents: 52,
            noAskCents: 51,
          }),
        ],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("no_stake");
    expect(plan.candidates[0].boundBy).toBe("no_edge_after_fees");
  });

  it("takes the side with the greater Kelly edge", () => {
    // A 30% yes probability against a 48c no ask is a NO opportunity.
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            rawYesProbability: 0.3,
            yesAskCents: 40,
            noAskCents: 48,
          }),
        ],
      }),
    );
    expect(plan.candidates[0].side).toBe("no");
  });

  it("stakes strictly less at lower confidence, all else equal", () => {
    const stakeFor = (confidence: "high" | "medium" | "low") =>
      planCycle(input({ candidates: [candidate({ confidence })] }))
        .candidates[0].intendedStakeCents;

    expect(stakeFor("medium")).toBeLessThan(stakeFor("high"));
    expect(stakeFor("low")).toBeLessThan(stakeFor("medium"));
  });

  it("stakes strictly more in a more aggressive mode, all else equal", () => {
    const stakeFor = (mode: "conservative" | "moderate" | "aggressive") =>
      planCycle(
        input({
          config: {
            mode,
            ...RISK_PRESETS[mode],
            probabilityCeiling: PROBABILITY_CEILING,
          },
        }),
      ).candidates[0].intendedStakeCents;

    expect(stakeFor("moderate")).toBeGreaterThan(stakeFor("conservative"));
    expect(stakeFor("aggressive")).toBeGreaterThan(stakeFor("moderate"));
  });
});

describe("ranking", () => {
  it("orders by Kelly edge descending, not by win probability", () => {
    // The pitch's own trap: an expensive near-certainty must rank below a
    // genuine mispricing.
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            contractId: "expensive",
            kalshiTicker: "AAA",
            rawYesProbability: 0.74,
            yesAskCents: 79,
            noAskCents: null,
          }),
          candidate({
            contractId: "mispriced",
            kalshiTicker: "ZZZ",
            rawYesProbability: 0.6,
            yesAskCents: 48,
            noAskCents: null,
          }),
        ],
      }),
    );
    expect(plan.candidates[0].contractId).toBe("mispriced");
    expect(plan.candidates[0].rank).toBe(0);
  });

  it("breaks ties on ticker so the ordering is total and reproducible", () => {
    const twins = input({
      candidates: [
        candidate({ contractId: "b", kalshiTicker: "BBB" }),
        candidate({ contractId: "a", kalshiTicker: "AAA" }),
      ],
    });
    const first = planCycle(twins).candidates.map((c) => c.contractId);
    const second = planCycle(twins).candidates.map((c) => c.contractId);
    expect(first).toEqual(["a", "b"]);
    expect(second).toEqual(first);
  });

  it("ranks unpriceable candidates last", () => {
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            contractId: "refused",
            kalshiTicker: "AAA",
            staleness: {
              isStale: true,
              predatesInactives: false,
              inactivesExpectedAt: null,
            },
          }),
          candidate({ contractId: "priced", kalshiTicker: "ZZZ" }),
        ],
      }),
    );
    expect(plan.candidates[0].contractId).toBe("priced");
    expect(plan.candidates[1].contractId).toBe("refused");
  });
});

describe("caps", () => {
  it("records the FIRST cap that reduced the stake, not the tightest", () => {
    // The recorded constraint is the audit trail. A later cap that would also
    // have bound is not what actually determined the outcome.
    const plan = planCycle(
      input({
        activeBankrollCents: 100_000,
        availableBankrollCents: 500, // binds before either exposure cap
        candidates: [candidate()],
      }),
    );
    expect(plan.candidates[0].boundBy).toBe("available_bankroll");
  });

  it("binds on the per-game cap regardless of what Kelly proposed", () => {
    const plan = planCycle(
      input({
        config: {
          mode: "aggressive",
          ...RISK_PRESETS.aggressive,
          probabilityCeiling: PROBABILITY_CEILING,
        },
        activeBankrollCents: 100_000,
        availableBankrollCents: 100_000,
        gameExposureCents: 11_500, // 12% cap is 12,000; 500 remains
        candidates: [candidate()],
      }),
    );
    const c = plan.candidates[0];
    expect(c.boundBy).toBe("per_game_cap");
    expect(c.filledCostCents + c.filledFeeCents).toBeLessThanOrEqual(500);
  });

  it("binds on the per-slate cap when the game cap has room but the slate does not", () => {
    const plan = planCycle(
      input({
        activeBankrollCents: 100_000,
        availableBankrollCents: 100_000,
        gameExposureCents: 0,
        slateExposureCents: 14_800, // 15% cap is 15,000; 200 remains
        candidates: [candidate()],
      }),
    );
    expect(plan.candidates[0].boundBy).toBe("per_slate_cap");
  });

  it("never lets total spend exceed either cap", () => {
    const plan = planCycle(
      input({
        activeBankrollCents: 100_000,
        availableBankrollCents: 100_000,
        candidates: [
          candidate({ contractId: "a", kalshiTicker: "AAA" }),
          candidate({ contractId: "b", kalshiTicker: "BBB" }),
          candidate({ contractId: "c", kalshiTicker: "CCC" }),
          candidate({ contractId: "d", kalshiTicker: "DDD" }),
        ],
      }),
    );
    expect(plan.stakedCents).toBeLessThanOrEqual(plan.gameCapacityCents);
    expect(plan.stakedCents).toBeLessThanOrEqual(plan.slateCapacityCents);
  });

  it("scales capacity with CURRENT bankroll, not the starting balance", () => {
    expect(capacityCents(100_000, 15)).toBe(15_000);
    expect(capacityCents(52_000, 15)).toBe(7_800);
    expect(capacityCents(0, 15)).toBe(0);
  });
});

describe("fills are top of book only", () => {
  it("fills exactly the displayed size and returns the remainder", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskSizeContracts: 12, noAskCents: null })],
      }),
    );
    const c = plan.candidates[0];
    expect(c.verdict).toBe("partial");
    expect(c.filledContracts).toBe(12);
    expect(c.boundBy).toBe("top_of_book_size");
    expect(c.intendedContracts).toBeGreaterThan(12);
    expect(c.unfilledStakeCents).toBeGreaterThan(0);
    expect(plan.outcome).toBe("partial_fill");
  });

  it("never fills at any price but the displayed ask", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskSizeContracts: 12, noAskCents: null })],
      }),
    );
    const c = plan.candidates[0];
    expect(c.filledCostCents).toBe(12 * 54);
  });

  it("never fills more than the displayed size, across the whole price range", () => {
    for (let ask = 10; ask <= 90; ask += 5) {
      for (const size of [0, 1, 7, 40, 5_000]) {
        const plan = planCycle(
          input({
            candidates: [
              candidate({
                rawYesProbability: 0.7,
                yesAskCents: ask,
                yesAskSizeContracts: size,
                noAskCents: null,
              }),
            ],
          }),
        );
        expect(plan.candidates[0].filledContracts).toBeLessThanOrEqual(size);
        expect(plan.candidates[0].filledContracts).toBeLessThanOrEqual(
          plan.candidates[0].intendedContracts,
        );
      }
    }
  });

  it("takes no position when the displayed size is zero", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskSizeContracts: 0, noAskCents: null })],
      }),
    );
    expect(plan.candidates[0].verdict).toBe("no_stake");
    expect(plan.candidates[0].boundBy).toBe("top_of_book_size");
    expect(plan.candidates[0].filledContracts).toBe(0);
  });

  it("charges the fee on the FILLED count, not the intended one", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskSizeContracts: 12, noAskCents: null })],
      }),
    );
    // 0.07 x 12 x 0.54 x 0.46 = $0.2087... -> 21 cents
    expect(plan.candidates[0].filledFeeCents).toBe(21);
  });
});

describe("reallocation", () => {
  it("does not retry a candidate whose top of book it consumed", () => {
    // Reassessing the slate is valuable; chasing the same unavailable
    // liquidity is the rabbit hole the pitch names.
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            contractId: "thin",
            kalshiTicker: "AAA",
            yesAskSizeContracts: 3,
            noAskCents: null,
          }),
        ],
      }),
    );
    expect(plan.candidates[0].filledContracts).toBe(3);
    expect(
      plan.allocationTrace.some((line) =>
        line.includes("top of book was consumed"),
      ),
    ).toBe(true);
  });

  it("stops within the pass bound and says why", () => {
    const plan = planCycle(
      input({
        candidates: [
          candidate({ contractId: "a", kalshiTicker: "AAA" }),
          candidate({ contractId: "b", kalshiTicker: "BBB" }),
        ],
      }),
    );
    expect(plan.allocationPasses).toBeLessThanOrEqual(3);
    expect(plan.allocationTrace.length).toBeGreaterThan(0);
    expect(plan.allocationTrace[plan.allocationTrace.length - 1]).toContain(
      "left unallocated",
    );
  });

  it("states an unallocated remainder rather than hiding it", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskSizeContracts: 2, noAskCents: null })],
      }),
    );
    expect(
      plan.allocationTrace.some((line) => line.includes("left unallocated")),
    ).toBe(true);
  });

  it("reports a slate with nothing worth taking as a successful empty cycle", () => {
    const plan = planCycle(
      input({
        candidates: [
          candidate({
            rawYesProbability: 0.5,
            yesAskCents: 55,
            noAskCents: 55,
          }),
        ],
      }),
    );
    expect(plan.outcome).toBe("no_candidate");
    expect(plan.stakedCents).toBe(0);
    expect(plan.allocationTrace[0]).toContain("no candidate had positive");
  });
});

describe("duplicate prevention", () => {
  it("adds nothing when the desired total is already held", () => {
    const first = planCycle(input());
    const held = first.candidates[0].desiredTotalContracts;

    const retry = planCycle(
      input({
        heldByContractId: { c1: { side: "yes" as const, contracts: held } },
      }),
    );
    expect(retry.candidates[0].verdict).toBe("no_stake");
    expect(retry.candidates[0].boundByDetail).toBe(
      "desired total already held",
    );
    expect(retry.stakedCents).toBe(0);
  });

  it("adds only the increment when new information raises the desired total", () => {
    // The pitch's example: wanted 20, now wants 30, adds 10 — never runs the
    // 30 again and ends up holding 50.
    const richer = input({
      candidates: [candidate({ rawYesProbability: 0.68 })],
    });
    const desired = planCycle(richer).candidates[0].desiredTotalContracts;
    const held = desired - 10;

    const incremental = planCycle({
      ...richer,
      heldByContractId: { c1: { side: "yes" as const, contracts: held } },
    });
    expect(incremental.candidates[0].intendedContracts).toBe(10);
    expect(
      held + incremental.candidates[0].filledContracts,
    ).toBeLessThanOrEqual(desired);
  });

  it("adds nothing when more is held than is now desired", () => {
    const desired = planCycle(input()).candidates[0].desiredTotalContracts;
    const plan = planCycle(
      input({
        heldByContractId: {
          c1: { side: "yes" as const, contracts: desired + 50 },
        },
      }),
    );
    expect(plan.candidates[0].intendedContracts).toBe(0);
    expect(plan.stakedCents).toBe(0);
  });

  it("refuses a candidate whose better side has flipped away from the position", () => {
    // The executor cannot write an increment on the opposite side of an open
    // position, and a throw there aborts the whole cycle run. The planner has
    // to see the side, so it can refuse here instead.
    const desired = planCycle(input()).candidates[0].desiredTotalContracts;
    const plan = planCycle(
      input({
        heldByContractId: { c1: { side: "no" as const, contracts: desired } },
      }),
    );
    const c = plan.candidates[0];
    expect(c.side).toBe("yes");
    expect(c.verdict).toBe("refused");
    expect(c.filledContracts).toBe(0);
    expect(c.intendedContracts).toBe(0);
    expect(c.boundBy).toBe("opposite_side_held");
    expect(c.boundByDetail).toContain("no");
    expect(plan.stakedCents).toBe(0);
  });

  it("does not report an opposite-side holding as the desired total", () => {
    // The quiet half of the same bug: an increment landing at zero would be
    // recorded as "desired total already held" when what is held is the other
    // side of the market entirely.
    const desired = planCycle(input()).candidates[0].desiredTotalContracts;
    const plan = planCycle(
      input({
        heldByContractId: {
          c1: { side: "no" as const, contracts: desired + 100 },
        },
      }),
    );
    expect(plan.candidates[0].boundByDetail).not.toBe(
      "desired total already held",
    );
  });

  it("caps the increment as if evaluated fresh", () => {
    const desired = planCycle(input()).candidates[0].desiredTotalContracts;
    const plan = planCycle(
      input({
        heldByContractId: {
          c1: { side: "yes" as const, contracts: desired - 40 },
        },
        availableBankrollCents: 300,
      }),
    );
    const c = plan.candidates[0];
    expect(c.filledCostCents + c.filledFeeCents).toBeLessThanOrEqual(300);
    expect(c.boundBy === "available_bankroll" || c.filledContracts > 0).toBe(
      true,
    );
  });
});

describe("the fill record says what actually happened", () => {
  it("reports no unfilled stake on a complete fill", () => {
    // `intendedStakeCents` is contracts x a PER-CONTRACT fee ceiling, while the
    // cost charged is one ORDER-level ceiling, so the former is always larger.
    // Subtracting one from the other left a few cents of "stake returned" on a
    // position that filled entirely, which the cycle detail and the positions
    // list both displayed.
    const plan = planCycle(input());
    const filled = plan.candidates.filter((c) => c.verdict === "filled");
    expect(filled.length).toBeGreaterThan(0);
    for (const candidate of filled) {
      expect(candidate.unfilledStakeCents).toBe(0);
    }
  });

  it("reports unfilled stake in whole unfilled contracts on a partial fill", () => {
    const desired = planCycle(input()).candidates[0].desiredTotalContracts;
    const short = Math.max(1, desired - 1);
    const plan = planCycle(
      input({ candidates: [candidate({ yesAskSizeContracts: short })] }),
    );
    const c = plan.candidates[0];
    expect(c.verdict).toBe("partial");
    expect(c.unfilledStakeCents).toBe(
      (c.intendedContracts - c.filledContracts) * (c.netPriceCents as number),
    );
  });
});

describe("the audit trail", () => {
  it("gives every candidate exactly one binding constraint, never blank", () => {
    const plan = planCycle(
      input({
        candidates: [
          candidate({ contractId: "ok", kalshiTicker: "AAA" }),
          candidate({
            contractId: "ceiling",
            kalshiTicker: "BBB",
            rawYesProbability: 0.9,
            noAskCents: null,
          }),
          candidate({
            contractId: "stale",
            kalshiTicker: "CCC",
            staleness: {
              isStale: true,
              predatesInactives: false,
              inactivesExpectedAt: null,
            },
          }),
          candidate({
            contractId: "thin",
            kalshiTicker: "DDD",
            yesAskSizeContracts: 0,
            noAskCents: null,
          }),
          candidate({
            contractId: "noedge",
            kalshiTicker: "EEE",
            rawYesProbability: 0.5,
            yesAskCents: 55,
            noAskCents: 55,
          }),
        ],
      }),
    );

    for (const c of plan.candidates) {
      expect(typeof c.boundBy).toBe("string");
      expect(c.boundBy.length).toBeGreaterThan(0);
    }
    const byId = Object.fromEntries(
      plan.candidates.map((c) => [c.contractId, c.boundBy]),
    );
    expect(byId.ceiling).toBe("probability_ceiling");
    expect(byId.stale).toBe("stale_projection");
    expect(byId.thin).toBe("top_of_book_size");
    expect(byId.noedge).toBe("no_edge_after_fees");
  });

  it("retains intended and filled as two separate numbers", () => {
    const plan = planCycle(
      input({
        candidates: [candidate({ yesAskSizeContracts: 5, noAskCents: null })],
      }),
    );
    const c = plan.candidates[0];
    expect(c.intendedContracts).toBeGreaterThan(c.filledContracts);
    expect(c.intendedStakeCents).toBeGreaterThan(0);
    expect(c.unfilledStakeCents).toBeGreaterThan(0);
  });

  it("keeps the raw probability visible beside the corrected one", () => {
    const shrinking: ActiveRecalibration = {
      ...IDENTITY,
      knots: [
        [0, 0],
        [0.62, 0.55],
        [1, 1],
      ],
    };
    const plan = planCycle(input({ recalibration: shrinking }));
    const c = plan.candidates[0];
    expect(c.rawProbability).toBe(0.62);
    expect(c.correctedProbability).toBeCloseTo(0.55, 6);
    expect(c.correctedProbability).not.toBe(c.rawProbability);
  });

  it("sizes from the corrected probability, never the raw one", () => {
    const shrinking: ActiveRecalibration = {
      ...IDENTITY,
      knots: [
        [0, 0],
        [0.62, 0.55],
        [1, 1],
      ],
    };
    const corrected = planCycle(input({ recalibration: shrinking }));
    const raw = planCycle(input());
    expect(corrected.candidates[0].intendedStakeCents).toBeLessThan(
      raw.candidates[0].intendedStakeCents,
    );
  });

  it("records the fee-adjusted price, which always exceeds the ask", () => {
    const plan = planCycle(input());
    const c = plan.candidates[0];
    expect(c.netPriceCents).toBe(netPriceCents(54));
    expect(c.netPriceCents as number).toBeGreaterThan(c.askCents as number);
  });
});

describe("pastCutoff", () => {
  it("is exclusive of the boundary minute in the safe direction", () => {
    expect(pastCutoff(new Date(KICKOFF.getTime() - 10 * 60_000), KICKOFF)).toBe(
      true,
    );
    expect(
      pastCutoff(new Date(KICKOFF.getTime() - 10 * 60_000 - 1), KICKOFF),
    ).toBe(false);
  });

  it("is true after kickoff", () => {
    expect(pastCutoff(new Date(KICKOFF.getTime() + 60_000), KICKOFF)).toBe(
      true,
    );
  });
});

describe("determinism", () => {
  it("produces an identical plan from identical inputs", () => {
    // Replay depends on this: if the same inputs could produce two plans, a
    // counterfactual would prove nothing.
    const shared = input({
      candidates: [
        candidate({ contractId: "a", kalshiTicker: "AAA" }),
        candidate({
          contractId: "b",
          kalshiTicker: "BBB",
          rawYesProbability: 0.58,
          yesAskCents: 49,
          yesAskSizeContracts: 12,
        }),
        candidate({
          contractId: "c",
          kalshiTicker: "CCC",
          rawYesProbability: 0.71,
          yesAskCents: 62,
        }),
      ],
    });
    expect(JSON.stringify(planCycle(shared))).toBe(
      JSON.stringify(planCycle(shared)),
    );
  });
});
