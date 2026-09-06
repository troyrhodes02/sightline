/**
 * The shared outcome block against a mocked Prisma seam: the two truths stay
 * two facts, disagreement is flagged with both preserved, and every absent
 * grade carries its taxonomy state rather than a blank or a zero.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    outcome: { findUnique: jest.fn() },
    recommendationSnapshot: { findFirst: jest.fn() },
    thresholdGrade: { findFirst: jest.fn() },
    playerGameStat: { findUnique: jest.fn() },
    projectionGrade: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { readOutcomeBlock, type OutcomeBlockContext } from "./outcome-block";

const mockPrisma = prisma as unknown as {
  outcome: { findUnique: jest.Mock };
  recommendationSnapshot: { findFirst: jest.Mock };
  thresholdGrade: { findFirst: jest.Mock };
  playerGameStat: { findUnique: jest.Mock };
  projectionGrade: { findMany: jest.Mock };
};

const CONTEXT: OutcomeBlockContext = {
  contractId: "c1",
  playerId: "p1",
  gameId: "g1",
  statType: "receiving_yards",
  threshold: 74.5,
  gameStatus: "completed",
  displayedProjectionId: "proj-1",
};

function seed({
  outcome = { result: "yes", settledAt: new Date("2026-11-09T06:04:00Z") },
  finalSnapshot = { side: "yes" },
  thresholdGrade = { statedProbability: 0.614, outcome: true },
  stat = {
    passingYards: null,
    rushingYards: null,
    receivingYards: 87,
    receptions: 6,
    rushingTds: null,
    receivingTds: null,
    corrections: [],
  },
  grades = [{ projectionId: "proj-1", status: "graded", officialValue: 87 }],
}: Record<string, unknown> = {}) {
  mockPrisma.outcome.findUnique.mockResolvedValue(outcome);
  mockPrisma.recommendationSnapshot.findFirst.mockResolvedValue(finalSnapshot);
  mockPrisma.thresholdGrade.findFirst.mockResolvedValue(thresholdGrade);
  mockPrisma.playerGameStat.findUnique.mockResolvedValue(stat);
  mockPrisma.projectionGrade.findMany.mockResolvedValue(grades);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("readOutcomeBlock", () => {
  it("agree: official line, settlement, grade, and a correct recommendation", async () => {
    seed();
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.officialValue).toBe(87);
    expect(block.settlement).toEqual({
      result: "yes",
      settledAt: "2026-11-09T06:04:00.000Z",
    });
    expect(block.projectionGrade).toEqual({
      status: "graded",
      hit: true,
      statedProbability: 0.614,
    });
    expect(block.recommendationGrade).toBe("correct");
    expect(block.sourcesDisagree).toBe(false);
    // The shared read NEVER emits the admin key — it is attached elsewhere.
    expect("decision" in block).toBe(false);
  });

  it("disagree: both truths preserved and the flag raised", async () => {
    seed({
      outcome: { result: "no", settledAt: null },
      thresholdGrade: { statedProbability: 0.614, outcome: true },
    });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.sourcesDisagree).toBe(true);
    expect(block.officialValue).toBe(87);
    expect(block.settlement?.result).toBe("no");
    expect(block.recommendationGrade).toBe("incorrect");
  });

  it("pending: game complete, no settlement yet — nothing fabricated", async () => {
    seed({ outcome: null });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.settlement).toBeNull();
    expect(block.recommendationGrade).toBe("pending");
    expect(block.sourcesDisagree).toBe(false);
  });

  it("voided: its own state, not correct, incorrect, or a disagreement", async () => {
    seed({ outcome: { result: "voided", settledAt: null } });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.settlement?.result).toBe("voided");
    expect(block.recommendationGrade).toBe("voided");
    expect(block.sourcesDisagree).toBe(false);
  });

  it("no final snapshot: explicitly unavailable, never graded by substitute", async () => {
    seed({ finalSnapshot: null });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.recommendationGrade).toBe("missing_final_snapshot");
  });

  it("surfaces the latest correction date beside the official line", async () => {
    seed({
      stat: {
        receivingYards: 92,
        passingYards: null,
        rushingYards: null,
        receptions: null,
        rushingTds: null,
        receivingTds: null,
        corrections: [{ correctionKnownAt: new Date("2026-11-11T18:10:00Z") }],
      },
    });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.officialValue).toBe(92);
    expect(block.officialCorrectedAt).toBe("2026-11-11T18:10:00.000Z");
  });

  it("a non-graded status travels as its taxonomy state, no values invented", async () => {
    seed({
      thresholdGrade: null,
      stat: null,
      grades: [
        {
          projectionId: "proj-1",
          status: "missing_official_result",
          officialValue: null,
        },
      ],
    });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.officialValue).toBeNull();
    expect(block.projectionGrade).toEqual({
      status: "missing_official_result",
      hit: null,
      statedProbability: null,
    });
  });

  it("graded but no market threshold row yet: hit derives, probability stays honest", async () => {
    seed({ thresholdGrade: null });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.projectionGrade).toEqual({
      status: "graded",
      hit: true, // 87 > 74.5
      statedProbability: null,
    });
    expect(block.sourcesDisagree).toBe(false); // one truth short of a conflict
  });

  it("no grade rows at all: the grade line is null — pending, not zero", async () => {
    seed({ thresholdGrade: null, grades: [] });
    const block = await readOutcomeBlock(CONTEXT);
    expect(block.projectionGrade).toBeNull();
  });

  it("an unresolved contract skips stat and grade lookups entirely", async () => {
    seed({ outcome: { result: "yes", settledAt: null }, thresholdGrade: null });
    const block = await readOutcomeBlock({
      ...CONTEXT,
      playerId: null,
      gameId: null,
      statType: null,
      threshold: null,
    });
    expect(mockPrisma.playerGameStat.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.projectionGrade.findMany).not.toHaveBeenCalled();
    expect(block.officialValue).toBeNull();
    expect(block.settlement?.result).toBe("yes");
  });
});
