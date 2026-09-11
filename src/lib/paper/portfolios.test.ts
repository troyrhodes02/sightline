import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import { prisma } from "@/lib/prisma";
import { BASELINE_VERSION, SIMULATION_VERSION } from "@/lib/model-eval/config";
import type { StatType } from "../../../generated/prisma/enums";
import { resolvePortfolios, selectionIsHybrid } from "./portfolios";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paperEvaluationCampaign: { findUniqueOrThrow: jest.fn() },
    paperCampaign: { create: jest.fn() },
    modelSelection: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  paperEvaluationCampaign: { findUniqueOrThrow: jest.Mock };
  paperCampaign: { create: jest.Mock };
  modelSelection: { findMany: jest.Mock };
};

const EXECUTE = readCode(
  join(process.cwd(), "src", "lib", "paper", "execute.ts"),
);
const CYCLE = readCode(
  join(process.cwd(), "src", "lib", "pipeline", "paper-cycle.ts"),
);

function selectionRows(map: Record<string, string>) {
  return Object.entries(map).map(([statType, modelVersion]) => ({
    statType: statType as StatType,
    modelVersion,
  }));
}

describe("selectionIsHybrid", () => {
  it("is false for a uniformly-baseline selection", () => {
    expect(
      selectionIsHybrid(
        new Map<StatType, string>([
          ["passing_yards", BASELINE_VERSION],
          ["rushing_yards", BASELINE_VERSION],
        ]),
      ),
    ).toBe(false);
  });

  it("is false for a uniformly-simulation selection", () => {
    expect(
      selectionIsHybrid(
        new Map<StatType, string>([["receiving_yards", SIMULATION_VERSION]]),
      ),
    ).toBe(false);
  });

  it("is true when the selection names more than one model", () => {
    expect(
      selectionIsHybrid(
        new Map<StatType, string>([
          ["passing_yards", BASELINE_VERSION],
          ["receiving_yards", SIMULATION_VERSION],
        ]),
      ),
    ).toBe(true);
  });
});

describe("resolvePortfolios", () => {
  beforeEach(() => jest.clearAllMocks());

  const START = new Date("2026-09-01T00:00:00Z");

  it("provisions baseline + simulation and no hybrid for a uniform selection", async () => {
    mockPrisma.modelSelection.findMany.mockResolvedValue(
      selectionRows({ passing_yards: BASELINE_VERSION }),
    );
    mockPrisma.paperEvaluationCampaign.findUniqueOrThrow.mockResolvedValue({
      startingBankrollCents: 100_000,
      campaignStartedAt: START,
      portfolios: [],
    });
    let created = 0;
    mockPrisma.paperCampaign.create.mockImplementation(async ({ data }) => ({
      id: `new-${created++}`,
      portfolio: data.portfolio,
      highWaterMarkCents: data.highWaterMarkCents,
      startingBankrollCents: data.startingBankrollCents,
      autonomyEnabled: data.autonomyEnabled,
    }));

    const targets = await resolvePortfolios("ec1");
    expect(targets.map((t) => t.portfolio)).toEqual(["baseline", "simulation"]);
    // Both seeded from the SAME starting bankroll.
    for (const t of targets) expect(t.startingBankrollCents).toBe(100_000);
  });

  it("provisions a hybrid portfolio when the selection is mixed", async () => {
    mockPrisma.modelSelection.findMany.mockResolvedValue(
      selectionRows({
        passing_yards: BASELINE_VERSION,
        receiving_yards: SIMULATION_VERSION,
      }),
    );
    mockPrisma.paperEvaluationCampaign.findUniqueOrThrow.mockResolvedValue({
      startingBankrollCents: 100_000,
      campaignStartedAt: START,
      portfolios: [
        {
          id: "cb",
          portfolio: "baseline",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
        {
          id: "cs",
          portfolio: "simulation",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
      ],
    });
    mockPrisma.paperCampaign.create.mockImplementation(async ({ data }) => ({
      id: "ch",
      portfolio: data.portfolio,
      highWaterMarkCents: data.highWaterMarkCents,
      startingBankrollCents: data.startingBankrollCents,
      autonomyEnabled: data.autonomyEnabled,
    }));

    const targets = await resolvePortfolios("ec1");
    expect(targets.map((t) => t.portfolio)).toEqual([
      "baseline",
      "simulation",
      "hybrid",
    ]);
    // Only the hybrid was newly created; the two engines already existed.
    expect(mockPrisma.paperCampaign.create).toHaveBeenCalledTimes(1);
    expect(
      mockPrisma.paperCampaign.create.mock.calls[0][0].data.portfolio,
    ).toBe("hybrid");
  });

  it("resolves a fixed-engine portfolio to its own version for every stat", async () => {
    mockPrisma.modelSelection.findMany.mockResolvedValue(
      selectionRows({ passing_yards: BASELINE_VERSION }),
    );
    mockPrisma.paperEvaluationCampaign.findUniqueOrThrow.mockResolvedValue({
      startingBankrollCents: 100_000,
      campaignStartedAt: START,
      portfolios: [
        {
          id: "cb",
          portfolio: "baseline",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
        {
          id: "cs",
          portfolio: "simulation",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
      ],
    });

    const targets = await resolvePortfolios("ec1");
    const baseline = targets.find((t) => t.portfolio === "baseline")!;
    const simulation = targets.find((t) => t.portfolio === "simulation")!;
    expect(baseline.modelVersionForStat("passing_yards")).toBe(
      BASELINE_VERSION,
    );
    expect(baseline.modelVersionForStat("rushing_tds")).toBe(BASELINE_VERSION);
    expect(simulation.modelVersionForStat("receptions")).toBe(
      SIMULATION_VERSION,
    );
  });

  it("resolves a hybrid portfolio per stat from the live selection", async () => {
    mockPrisma.modelSelection.findMany.mockResolvedValue(
      selectionRows({
        passing_yards: BASELINE_VERSION,
        receiving_yards: SIMULATION_VERSION,
      }),
    );
    mockPrisma.paperEvaluationCampaign.findUniqueOrThrow.mockResolvedValue({
      startingBankrollCents: 100_000,
      campaignStartedAt: START,
      portfolios: [
        {
          id: "ch",
          portfolio: "hybrid",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
        {
          id: "cb",
          portfolio: "baseline",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
        {
          id: "cs",
          portfolio: "simulation",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
      ],
    });

    const targets = await resolvePortfolios("ec1");
    const hybrid = targets.find((t) => t.portfolio === "hybrid")!;
    expect(hybrid.modelVersionForStat("passing_yards")).toBe(BASELINE_VERSION);
    expect(hybrid.modelVersionForStat("receiving_yards")).toBe(
      SIMULATION_VERSION,
    );
    // A stat the selection does not name has no model — hybrid selects nothing
    // for it, exactly as the slate does.
    expect(hybrid.modelVersionForStat("rushing_tds")).toBeNull();
  });
});

describe("Hybrid attribution is fixed at open time and never rewritten (D6)", () => {
  it("sets sourceModelVersion on the position from the candidate's model version", () => {
    // The writer stamps the position's sourceModelVersion from the candidate's
    // own modelVersion at open time.
    expect(EXECUTE).toContain("sourceModelVersion: candidate.modelVersion");
  });

  it("never updates sourceModelVersion after a position is created", () => {
    // Attribution is permanent: a later ModelSelection change must not rewrite
    // it. The only paperPosition.update in the writer is the increment path,
    // which touches contracts/cost/fees/stake — never sourceModelVersion.
    const updateBlocks = [
      ...EXECUTE.matchAll(/paperPosition\.update\(\{[\s\S]*?\}\)/g),
    ].map((m) => m[0]);
    for (const block of updateBlocks) {
      expect(block).not.toContain("sourceModelVersion");
    }
  });

  it("candidate model version flows from the projection selected for the portfolio", () => {
    // The hybrid portfolio prices each stat from the selected model; the
    // candidate carries that projection's modelVersion, which becomes the
    // permanent attribution.
    expect(CYCLE).toContain("modelVersionForStat");
    expect(CYCLE).toContain("modelVersion: projection?.modelVersion ?? null");
  });
});

describe("the three portfolios never merge", () => {
  it("scopes every cycle read and write by a single portfolio's campaignId", () => {
    // The loop iterates portfolios and passes each portfolio's OWN campaignId
    // into evaluateOneGame; there is no cross-portfolio aggregation in the
    // cycle path.
    expect(CYCLE).toContain("for (const portfolio of portfolios)");
    expect(CYCLE).toContain("campaignId: portfolio.campaignId");
    // No portfolio's ledger is read across a set of campaign ids in the cycle
    // path — that would be a merge.
    expect(CYCLE).not.toMatch(/campaignId:\s*\{\s*in:/);
  });

  it("namespaces the idempotency key per portfolio so a coalesce cannot cross portfolios", () => {
    expect(CYCLE).toContain("${input.invocationId}:${portfolio.portfolio}");
  });
});
