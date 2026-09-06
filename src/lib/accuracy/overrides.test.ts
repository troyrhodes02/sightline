/**
 * The override read against a mocked Prisma seam: acted-on selection,
 * three-state tiles, the agreement table, timing aggregation, and the
 * disagreement flag — all from controlled rows, no database.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    decision: { findMany: jest.fn() },
    game: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  decisionSeasons,
  parseOverridesScope,
  readOverridePerformance,
} from "./overrides";

const mockPrisma = prisma as unknown as {
  decision: { findMany: jest.Mock };
  game: { findMany: jest.Mock };
};

type DecisionFixture = ReturnType<typeof decisionRow>;

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    contractId: "c1",
    userId: "u1",
    disposition: "took",
    decidedAt: new Date("2026-11-08T16:02:00Z"),
    snapshotSide: "yes",
    snapshotEdgePoints: 7.4,
    snapshotModelProbability: 0.6,
    priceObservation: { yesAskCents: 53, noAskCents: 49 },
    contract: {
      title: "Chase receiving yards above 74.5",
      kalshiPlayerName: "Ja'Marr Chase",
      statType: "receiving_yards",
      threshold: 74.5,
      player: { fullName: "Ja'Marr Chase" },
      outcome: { result: "yes" },
      snapshots: [
        {
          side: "yes",
          modelProbability: 0.62,
          edgePoints: 8.1,
          isRecommended: true,
          priceObservation: { yesAskCents: 54, noAskCents: 48 },
        },
      ],
      thresholdGrades: [{ outcome: true }],
    },
    ...overrides,
  };
}

function feed(rows: DecisionFixture[]) {
  mockPrisma.decision.findMany.mockResolvedValue(rows);
}

const SCOPE = { statType: "all", season: "all" } as const;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("acted-on selection", () => {
  it("selects only chain heads — the query itself excludes superseded rows", async () => {
    feed([]);
    await readOverridePerformance(SCOPE);
    const args = mockPrisma.decision.findMany.mock.calls[0][0];
    expect(args.where.supersededBy).toEqual({ is: null });
  });

  it("scopes stat and season through the contract, silently omitted at 'all'", async () => {
    feed([]);
    await readOverridePerformance({ statType: "receptions", season: 2026 });
    const scoped = mockPrisma.decision.findMany.mock.calls[0][0];
    expect(scoped.where.contract.statType).toBe("receptions");
    expect(scoped.where.contract.game).toEqual({ season: 2026 });

    feed([]);
    await readOverridePerformance(SCOPE);
    const unscoped = mockPrisma.decision.findMany.mock.calls[1][0];
    expect(unscoped.where.contract.statType).toBeUndefined();
    expect(unscoped.where.contract.game).toBeUndefined();
  });

  it("keeps one acted-on state per contract per user even if duplicates leak", async () => {
    feed([
      decisionRow({ decidedAt: new Date("2026-11-08T16:02:00Z") }),
      decisionRow({
        decidedAt: new Date("2026-11-08T15:00:00Z"),
        disposition: "skipped",
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.decisions).toHaveLength(1);
    expect(dto.decisions[0].disposition).toBe("took");
    expect(dto.tiles.skipped.total).toBe(0);
  });
});

describe("tiles", () => {
  it("grades a take on the model's side and a fade on the side he preferred", async () => {
    feed([
      decisionRow(), // took yes, settled yes → won
      decisionRow({
        contractId: "c2",
        disposition: "faded",
        contract: {
          ...decisionRow().contract,
          outcome: { result: "no" }, // he preferred no → won
        },
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.tiles.took).toEqual({
      total: 1,
      settled: 1,
      won: 1,
      lost: 0,
      voided: 0,
      pending: 0,
    });
    expect(dto.tiles.faded.won).toBe(1);
    expect(dto.tiles.faded.lost).toBe(0);
  });

  it("describes skips with settlement sides and no win/loss anywhere", async () => {
    feed([
      decisionRow({ disposition: "skipped" }),
      decisionRow({
        contractId: "c2",
        disposition: "skipped",
        contract: { ...decisionRow().contract, outcome: { result: "no" } },
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.tiles.skipped).toEqual({
      total: 2,
      settledYes: 1,
      settledNo: 1,
      voided: 0,
      pending: 0,
    });
    expect(dto.decisions.map((row) => row.outcome).sort()).toEqual([
      "settled_no",
      "settled_yes",
    ]);
  });

  it("keeps voided out of every settled denominator and pending separate", async () => {
    feed([
      decisionRow({
        contract: { ...decisionRow().contract, outcome: { result: "voided" } },
      }),
      decisionRow({
        contractId: "c2",
        contract: { ...decisionRow().contract, outcome: null },
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.tiles.took.total).toBe(2);
    expect(dto.tiles.took.settled).toBe(0);
    expect(dto.tiles.took.voided).toBe(1);
    expect(dto.tiles.took.pending).toBe(1);
  });
});

describe("agreement table", () => {
  it("places decisions by the FINAL snapshot's recommendation state", async () => {
    feed([
      decisionRow(), // recommended, won
      decisionRow({
        contractId: "c2",
        contract: {
          ...decisionRow().contract,
          outcome: { result: "no" }, // lost
          snapshots: [
            {
              ...decisionRow().contract.snapshots[0],
              isRecommended: false,
            },
          ],
        },
      }),
      decisionRow({
        contractId: "c3",
        disposition: "skipped",
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    const took = dto.agreement.find((row) => row.disposition === "took");
    expect(took?.recommended).toEqual({ count: 1, won: 1 });
    expect(took?.notRecommended).toEqual({ count: 1, won: 0 });
    const skipped = dto.agreement.find((row) => row.disposition === "skipped");
    // Skips carry counts but NEVER a won figure.
    expect(skipped?.recommended).toEqual({ count: 1, won: null });
  });

  it("excludes decisions with no final snapshot — there is no state to place them against", async () => {
    feed([
      decisionRow({
        contract: { ...decisionRow().contract, snapshots: [] },
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    const took = dto.agreement.find((row) => row.disposition === "took");
    expect(took?.recommended.count).toBe(0);
    expect(took?.notRecommended.count).toBe(0);
    // Still visible in the tiles and the timing unavailable count.
    expect(dto.tiles.took.total).toBe(1);
    expect(dto.timing.unavailable).toEqual([
      { reason: "missing_final_snapshot", count: 1 },
    ]);
  });
});

describe("timing aggregation", () => {
  it("covers takes and fades only, with median, mean, and reasons — never zero-fill", async () => {
    feed([
      decisionRow(), // cost 8.1 − 7.4 = 0.7
      decisionRow({
        contractId: "c2",
        contract: {
          ...decisionRow().contract,
          snapshots: [
            { ...decisionRow().contract.snapshots[0], edgePoints: 9.5 },
          ],
        },
      }), // cost 2.1
      decisionRow({ contractId: "c3", disposition: "skipped" }),
      decisionRow({
        contractId: "c4",
        contract: { ...decisionRow().contract, snapshots: [] },
      }), // unavailable: missing_final_snapshot
      decisionRow({
        contractId: "c5",
        contract: { ...decisionRow().contract, outcome: { result: "voided" } },
      }), // unavailable: voided
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.timing.total).toBe(4); // skip excluded entirely
    expect(dto.timing.measurable).toBe(2);
    expect(dto.timing.medianPoints).toBeCloseTo(1.4, 5);
    expect(dto.timing.meanPoints).toBeCloseTo(1.4, 5);
    expect(dto.timing.unavailable).toEqual(
      expect.arrayContaining([
        { reason: "missing_final_snapshot", count: 1 },
        { reason: "voided", count: 1 },
      ]),
    );
    const skipRow = dto.decisions.find((row) => row.contractId === "c3");
    expect(skipRow?.timingCostPoints).toBeNull();
    expect(skipRow?.timingUnavailableReason).toBeNull();
  });
});

describe("rows", () => {
  it("flags a disagreement between the official line and the settlement", async () => {
    feed([
      decisionRow({
        contract: {
          ...decisionRow().contract,
          outcome: { result: "no" },
          thresholdGrades: [{ outcome: true }], // official value cleared the threshold
        },
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.decisions[0].sourcesDisagree).toBe(true);
  });

  it("never flags with a missing truth", async () => {
    feed([
      decisionRow({
        contract: { ...decisionRow().contract, thresholdGrades: [] },
      }),
    ]);
    const dto = await readOverridePerformance(SCOPE);
    expect(dto.decisions[0].sourcesDisagree).toBe(false);
  });
});

describe("scope parsing", () => {
  it("falls back silently on unrecognized values", () => {
    expect(
      parseOverridesScope({ stat: "yeet", season: "banana" }, [2026]),
    ).toEqual({ statType: "all", season: "all" });
    expect(
      parseOverridesScope({ stat: "receptions", season: "2026" }, [2026]),
    ).toEqual({ statType: "receptions", season: 2026 });
  });

  it("rejects a season with no decisions rather than showing a false empty scope", () => {
    expect(parseOverridesScope({ season: "2019" }, [2026]).season).toBe("all");
  });
});

describe("season options", () => {
  it("lists seasons that hold decisions, newest first", async () => {
    mockPrisma.game.findMany.mockResolvedValue([
      { season: 2026 },
      { season: 2025 },
    ]);
    await expect(decisionSeasons()).resolves.toEqual([2026, 2025]);
    const args = mockPrisma.game.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      contracts: { some: { decisions: { some: {} } } },
    });
  });
});
