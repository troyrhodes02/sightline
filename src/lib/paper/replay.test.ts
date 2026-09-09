import { prisma } from "@/lib/prisma";
import { runReplay } from "./replay";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paperCycle: { findMany: jest.fn() },
    paperPosition: { count: jest.fn() },
    paperCampaign: { findUniqueOrThrow: jest.fn() },
    paperRiskConfig: { findFirst: jest.fn() },
    outcome: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as unknown as {
  paperCycle: { findMany: jest.Mock };
  paperPosition: { count: jest.Mock };
  paperCampaign: { findUniqueOrThrow: jest.Mock };
  paperRiskConfig: { findFirst: jest.Mock };
  outcome: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

const NOW = new Date("2026-11-16T23:00:00Z");
const KICKOFF = new Date("2026-11-15T18:00:00Z");

/**
 * One candidate as the planner recorded it: a modest edge on the yes side,
 * priced at 40c with plenty of displayed depth.
 *
 * The edge is deliberately small enough that even Aggressive's desired stake
 * sits under every cap, so a second cycle for the same game has nothing left to
 * add. That makes "repeated cycles change nothing" an exact assertion rather
 * than an approximate one — a candidate whose first cycle is capped legitimately
 * tops up on the next, which is what the live path does too.
 */
function candidate(over: Partial<Record<string, unknown>> = {}) {
  return {
    contractId: "contract-1",
    rank: 0,
    side: "yes",
    verdict: "filled",
    correctedProbability: 0.44,
    confidence: "high",
    askCents: 40,
    topOfBookSizeContracts: 500,
    kellyEdge: 0.0398,
    filledContracts: 20,
    ...over,
  };
}

/** `n` cycles for the same game, all before its kickoff, all 30 minutes apart. */
function cyclesBeforeKickoff(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    id: `cycle-${index}`,
    startedAt: new Date(KICKOFF.getTime() - (6 - index * 0.5) * 60 * 60 * 1000),
    candidates: [candidate()],
    game: { id: "game-1", kickoffAt: KICKOFF, season: 2026, week: 11 },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.paperPosition.count.mockResolvedValue(0);
  mockPrisma.paperCampaign.findUniqueOrThrow.mockResolvedValue({
    startingBankrollCents: 100_000,
  });
  mockPrisma.paperRiskConfig.findFirst.mockResolvedValue({
    mode: "aggressive",
    withdrawalCeilingMultiple: 1.5,
  });
  mockPrisma.outcome.findMany.mockResolvedValue([
    { contractId: "contract-1", result: "yes" },
  ]);
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)({
      paperReplay: { create: jest.fn().mockResolvedValue({ id: "replay-1" }) },
      paperReplayModeResult: { create: jest.fn() },
    }),
  );
});

describe("duplicate prevention survives the replay", () => {
  it("opens one position across repeated cycles for the same game", async () => {
    // The period is replayable only once every position in it has settled, so
    // the outcome exists from the first iteration. Settling on the mere
    // EXISTENCE of an outcome therefore cleared the held map after cycle one,
    // and cycles two and three opened the full desired stake again — three
    // times the exposure of the live run they claim to be a counterfactual of.
    mockPrisma.paperCycle.findMany.mockResolvedValue(cyclesBeforeKickoff(3));

    const { results } = await runReplay(
      "c1",
      "game_window",
      KICKOFF.toISOString(),
      "u1",
      NOW,
    );

    for (const result of results) {
      expect(result.positionCount).toBe(1);
    }
  });

  it("matches a single cycle's result exactly, whatever the cycle count", async () => {
    mockPrisma.paperCycle.findMany.mockResolvedValue(cyclesBeforeKickoff(1));
    const one = await runReplay(
      "c1",
      "game_window",
      KICKOFF.toISOString(),
      "u1",
      NOW,
    );

    jest.clearAllMocks();
    beforeEachState();
    mockPrisma.paperCycle.findMany.mockResolvedValue(cyclesBeforeKickoff(4));
    const four = await runReplay(
      "c1",
      "game_window",
      KICKOFF.toISOString(),
      "u1",
      NOW,
    );

    // Cycles two through four price the same contract at the same edge and
    // already hold the desired total, so they add nothing. Every figure the
    // review screen shows must be identical.
    expect(four.results).toEqual(one.results);
  });
});

describe("the counterfactual finishes", () => {
  it("settles every position by the end, not at cost", async () => {
    mockPrisma.paperCycle.findMany.mockResolvedValue(cyclesBeforeKickoff(1));

    const { results } = await runReplay(
      "c1",
      "game_window",
      KICKOFF.toISOString(),
      "u1",
      NOW,
    );

    // A yes contract bought at 40c that settled yes returns a dollar each. The
    // alternative history has to reach a settled state for its P&L to be
    // comparable against an actual one that did.
    for (const result of results) {
      expect(result.netPnlCents).toBeGreaterThan(0);
      expect(result.endingActiveCents).toBeGreaterThan(100_000);
    }
  });
});

/** Re-applies the shared mock state after a `clearAllMocks` mid-test. */
function beforeEachState() {
  mockPrisma.paperPosition.count.mockResolvedValue(0);
  mockPrisma.paperCampaign.findUniqueOrThrow.mockResolvedValue({
    startingBankrollCents: 100_000,
  });
  mockPrisma.paperRiskConfig.findFirst.mockResolvedValue({
    mode: "aggressive",
    withdrawalCeilingMultiple: 1.5,
  });
  mockPrisma.outcome.findMany.mockResolvedValue([
    { contractId: "contract-1", result: "yes" },
  ]);
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)({
      paperReplay: { create: jest.fn().mockResolvedValue({ id: "replay-1" }) },
      paperReplayModeResult: { create: jest.fn() },
    }),
  );
}
