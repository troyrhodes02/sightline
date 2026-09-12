import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import { prisma } from "@/lib/prisma";
import { BASELINE_VERSION, SIMULATION_VERSION } from "@/lib/model-eval/config";
import type { StatType } from "../../../generated/prisma/enums";
import {
  resolveBots,
  resolvePortfolios,
  selectionIsHybrid,
} from "./portfolios";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paperEvaluationCampaign: { findUniqueOrThrow: jest.fn() },
    modelSelection: { findMany: jest.fn() },
    paperRiskConfig: { findFirst: jest.fn() },
    paperCampaign: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as unknown as {
  paperEvaluationCampaign: { findUniqueOrThrow: jest.Mock };
  modelSelection: { findMany: jest.Mock };
  paperRiskConfig: { findFirst: jest.Mock };
  paperCampaign: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

// Provisioning a sibling creates its campaign, opening-balance ledger entry, and
// a clone of the shared risk config atomically. These track the tx-scoped writes.
const txCampaignCreate = jest.fn();
const txLedgerCreate = jest.fn();
const txRiskConfigCreate = jest.fn();

function installTransaction() {
  mockPrisma.paperRiskConfig.findFirst.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) =>
      fn({
        paperCampaign: { create: txCampaignCreate },
        paperLedgerEntry: { create: txLedgerCreate },
        paperRiskConfig: { create: txRiskConfigCreate },
      }),
  );
}

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
  beforeEach(() => {
    jest.clearAllMocks();
    installTransaction();
  });

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
    txCampaignCreate.mockImplementation(async ({ data }) => ({
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
    // Each newly-provisioned sibling gets an opening-balance ledger entry so its
    // scorecard reads its starting bankroll, not a settled balance of zero.
    expect(txLedgerCreate).toHaveBeenCalledTimes(2);
    expect(txLedgerCreate.mock.calls[0][0].data.kind).toBe("opening_balance");
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
    txCampaignCreate.mockImplementation(async ({ data }) => ({
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
    expect(txCampaignCreate).toHaveBeenCalledTimes(1);
    expect(txCampaignCreate.mock.calls[0][0].data.portfolio).toBe("hybrid");
    // The hybrid mirrors baseline's autonomy deterministically, and gets its own
    // opening-balance ledger entry. Its risk config is the campaign's shared one,
    // read by the cycle — never cloned here (that keeps the config single-writer).
    expect(txCampaignCreate.mock.calls[0][0].data.autonomyEnabled).toBe(true);
    expect(txLedgerCreate).toHaveBeenCalledTimes(1);
    expect(txRiskConfigCreate).not.toHaveBeenCalled();
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

describe("resolveBots enumerates comparison + custom bots (Paper Bot Lab)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installTransaction();
  });

  const START = new Date("2026-09-01T00:00:00Z");

  it("returns the 3 comparison bots AND every custom bot, each priced by its engine", async () => {
    mockPrisma.modelSelection.findMany.mockResolvedValue(
      selectionRows({
        passing_yards: BASELINE_VERSION,
        receiving_yards: SIMULATION_VERSION,
      }),
    );
    // The parent already has all three comparison bots provisioned.
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
        {
          id: "ch",
          portfolio: "hybrid",
          highWaterMarkCents: 100_000,
          startingBankrollCents: 100_000,
          autonomyEnabled: true,
        },
      ],
    });
    // Two custom Lab bots, one paused. Both must appear in the cycle enumeration.
    mockPrisma.paperCampaign.findMany.mockResolvedValue([
      {
        id: "bot1",
        portfolio: "baseline",
        highWaterMarkCents: 50_000,
        startingBankrollCents: 50_000,
        autonomyEnabled: true,
      },
      {
        id: "bot2",
        portfolio: "hybrid",
        highWaterMarkCents: 50_000,
        startingBankrollCents: 50_000,
        autonomyEnabled: false,
      },
    ]);

    const bots = await resolveBots("ec1");
    // Comparison bots first, then custom bots.
    expect(bots.map((b) => b.campaignId)).toEqual([
      "cb",
      "cs",
      "ch",
      "bot1",
      "bot2",
    ]);
    // Custom bots resolved to the query with isComparison=false.
    expect(mockPrisma.paperCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { evaluationCampaignId: "ec1", isComparison: false },
      }),
    );
    // A custom hybrid bot prices per stat from the live selection, exactly like
    // the comparison hybrid; a custom baseline bot prices from baseline.
    const customBaseline = bots.find((b) => b.campaignId === "bot1")!;
    const customHybrid = bots.find((b) => b.campaignId === "bot2")!;
    expect(customBaseline.modelVersionForStat("rushing_tds")).toBe(
      BASELINE_VERSION,
    );
    expect(customHybrid.modelVersionForStat("receiving_yards")).toBe(
      SIMULATION_VERSION,
    );
    // Paused custom bot still returned; the cycle filters on autonomyEnabled.
    expect(customHybrid.autonomyEnabled).toBe(false);
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

describe("every bot's ledger stands alone and never merges", () => {
  it("scopes every cycle read and write by a single bot's campaignId", () => {
    // The loop iterates every bot (comparison + custom) and passes each bot's
    // OWN campaignId into evaluateOneGame; there is no cross-bot aggregation in
    // the cycle path.
    expect(CYCLE).toContain("for (const bot of bots)");
    expect(CYCLE).toContain("campaignId: bot.campaignId");
    // No bot's ledger is read across a set of campaign ids in the cycle path —
    // that would be a merge.
    expect(CYCLE).not.toMatch(/campaignId:\s*\{\s*in:/);
  });

  it("namespaces the idempotency key per bot by campaignId (portfolio is no longer unique)", () => {
    // Paper Bot Lab lets many bots share an engine, so the portfolio enum can no
    // longer namespace the key; the campaignId is unique per bot.
    expect(CYCLE).toContain("${input.invocationId}:${bot.campaignId}");
  });
});

describe("every bot sizes under its OWN latest risk config", () => {
  it("resolves the config per bot by campaignId, not one shared config", () => {
    // Paper Bot Lab: each bot has its own config from creation, and the cycle
    // reads EACH bot's latest PaperRiskConfig. The comparison bots share the
    // campaign config via saveConfiguration's fan-out; a custom bot uses its own.
    // Resolving per-bot is safe now (every bot has a config) — the old bug where
    // a config-less sibling was skipped cannot recur.
    expect(CYCLE).toContain("where: { campaignId: bot.campaignId }");
  });
});
