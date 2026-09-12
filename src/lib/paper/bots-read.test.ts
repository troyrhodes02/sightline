import { prisma } from "@/lib/prisma";
import { readBotDetail, readPaperBots } from "./bots-read";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paperCampaign: { findMany: jest.fn(), findUnique: jest.fn() },
    paperLedgerEntry: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    paperPosition: { findMany: jest.fn(), count: jest.fn() },
    priceObservation: { findMany: jest.fn() },
    paperRiskConfig: { findFirst: jest.fn() },
    paperCycle: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  paperCampaign: { findMany: jest.Mock; findUnique: jest.Mock };
  paperLedgerEntry: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    aggregate: jest.Mock;
  };
  paperPosition: { findMany: jest.Mock; count: jest.Mock };
  priceObservation: { findMany: jest.Mock };
  paperRiskConfig: { findFirst: jest.Mock };
  paperCycle: { findMany: jest.Mock };
};

const START = 100_000;

beforeEach(() => {
  jest.clearAllMocks();
  // campaignFinancials reads: settled balance, open positions (none), price obs,
  // withdrawal aggregate, position count, latest risk config.
  mockPrisma.paperLedgerEntry.findFirst.mockImplementation(
    async ({ where }: { where: { campaignId: string } }) => ({
      balanceAfterCents: settledByCampaign[where.campaignId] ?? START,
    }),
  );
  mockPrisma.paperLedgerEntry.aggregate.mockResolvedValue({
    _sum: { amountCents: 0 },
  });
  mockPrisma.paperPosition.findMany.mockResolvedValue([]);
  mockPrisma.priceObservation.findMany.mockResolvedValue([]);
  mockPrisma.paperPosition.count.mockImplementation(
    async ({ where }: { where: { campaignId: string } }) =>
      positionCountByCampaign[where.campaignId] ?? 0,
  );
  mockPrisma.paperRiskConfig.findFirst.mockResolvedValue({ mode: "moderate" });
});

let settledByCampaign: Record<string, number> = {};
let positionCountByCampaign: Record<string, number> = {};

describe("readPaperBots", () => {
  it("returns ALL bots (comparison + custom), comparison first in engine order", async () => {
    settledByCampaign = {
      cb: START + 5_000,
      cs: START,
      ch: START,
      custom1: START - 1_000,
    };
    positionCountByCampaign = { cb: 3, custom1: 1 };
    mockPrisma.paperCampaign.findMany.mockResolvedValue([
      // Deliberately unordered.
      {
        id: "custom1",
        label: "My Bot",
        portfolio: "baseline",
        startingBankrollCents: START,
        highWaterMarkCents: START,
        autonomyEnabled: true,
        isComparison: false,
        startedAt: new Date("2026-10-01"),
      },
      {
        id: "cs",
        label: "Simulation",
        portfolio: "simulation",
        startingBankrollCents: START,
        highWaterMarkCents: START,
        autonomyEnabled: true,
        isComparison: true,
        startedAt: new Date("2026-09-01"),
      },
      {
        id: "cb",
        label: "Baseline",
        portfolio: "baseline",
        startingBankrollCents: START,
        highWaterMarkCents: START,
        autonomyEnabled: true,
        isComparison: true,
        startedAt: new Date("2026-09-01"),
      },
      {
        id: "ch",
        label: "Hybrid",
        portfolio: "hybrid",
        startingBankrollCents: START,
        highWaterMarkCents: START,
        autonomyEnabled: true,
        isComparison: true,
        startedAt: new Date("2026-09-01"),
      },
    ]);

    const bots = await readPaperBots("ec1");
    // Comparison bots first (baseline → simulation → hybrid), then custom bots.
    expect(bots.map((b) => b.id)).toEqual(["cb", "cs", "ch", "custom1"]);
    expect(bots.map((b) => b.isComparison)).toEqual([true, true, true, false]);

    const cb = bots.find((b) => b.id === "cb")!;
    expect(cb.name).toBe("Baseline");
    expect(cb.engine).toBe("baseline");
    expect(cb.netPnlCents).toBe(5_000);
    expect(cb.positionCount).toBe(3);

    const custom = bots.find((b) => b.id === "custom1")!;
    expect(custom.name).toBe("My Bot");
    expect(custom.isComparison).toBe(false);
    expect(custom.netPnlCents).toBe(-1_000);
    expect(custom.positionCount).toBe(1);
  });

  it("names an unnamed comparison bot by its engine", async () => {
    settledByCampaign = { cb: START };
    mockPrisma.paperCampaign.findMany.mockResolvedValue([
      {
        id: "cb",
        label: null,
        portfolio: "baseline",
        startingBankrollCents: START,
        highWaterMarkCents: START,
        autonomyEnabled: true,
        isComparison: true,
        startedAt: new Date("2026-09-01"),
      },
    ]);
    const bots = await readPaperBots("ec1");
    expect(bots[0].name).toBe("Baseline");
  });
});

describe("readBotDetail", () => {
  it("returns null for an unknown bot", async () => {
    mockPrisma.paperCampaign.findUnique.mockResolvedValue(null);
    expect(await readBotDetail("nope")).toBeNull();
  });

  it("assembles summary, bankroll history, positions, and recent cycles", async () => {
    settledByCampaign = { bot1: START + 2_000 };
    positionCountByCampaign = { bot1: 2 };
    mockPrisma.paperCampaign.findUnique.mockResolvedValue({
      id: "bot1",
      label: "My Bot",
      portfolio: "simulation",
      startingBankrollCents: START,
      highWaterMarkCents: START + 2_000,
      autonomyEnabled: true,
      isComparison: false,
    });
    mockPrisma.paperLedgerEntry.findMany.mockResolvedValue([
      // Returned newest-first; the read reverses to chronological.
      { occurredAt: new Date("2026-10-02"), balanceAfterCents: START + 2_000 },
      { occurredAt: new Date("2026-10-01"), balanceAfterCents: START },
    ]);
    const openPosition = {
      id: "p1",
      contractId: "k1",
      side: "yes",
      contracts: 10,
      costBasisCents: 400,
      feesPaidCents: 5,
      intendedStakeCents: 500,
      status: "open",
      settlementResult: null,
      realizedPnlCents: null,
      openedAt: new Date("2026-10-02"),
      settledAt: null,
      contract: {
        kalshiPlayerName: "P",
        statType: "receiving_yards",
        threshold: 50,
        player: { fullName: "Player One" },
      },
    };
    const settledPosition = {
      id: "p2",
      contractId: "k2",
      side: "no",
      contracts: 5,
      costBasisCents: 200,
      feesPaidCents: 2,
      intendedStakeCents: 200,
      status: "settled",
      settlementResult: "no",
      realizedPnlCents: 300,
      openedAt: new Date("2026-10-01"),
      settledAt: new Date("2026-10-03"),
      contract: {
        kalshiPlayerName: "Q",
        statType: "rushing_yards",
        threshold: 40,
        player: null,
      },
    };
    // campaignFinancials marks only OPEN positions; the detail read fetches ALL.
    mockPrisma.paperPosition.findMany.mockImplementation(
      async ({ where }: { where: { status?: string } }) =>
        where?.status === "open"
          ? [openPosition]
          : [openPosition, settledPosition],
    );
    mockPrisma.priceObservation.findMany.mockResolvedValue([
      { contractId: "k1", yesBidCents: 55, noBidCents: 45 },
    ]);
    mockPrisma.paperCycle.findMany.mockResolvedValue([
      {
        id: "cy1",
        startedAt: new Date("2026-10-02"),
        outcome: "traded",
        skipReason: null,
        candidatesEvaluated: 4,
        candidatesSized: 2,
        candidatesFilled: 1,
        stakedCents: 500,
        game: {
          kickoffAt: new Date("2026-10-02T20:00:00Z"),
          homeTeam: { nflverseAbbr: "KC" },
          awayTeam: { nflverseAbbr: "BUF" },
        },
      },
    ]);

    const detail = await readBotDetail("bot1");
    expect(detail).not.toBeNull();
    expect(detail!.summary.name).toBe("My Bot");
    // Mark-to-market: settled (102000) + open value (yes bid 55 × 10 = 550)
    // − starting (100000) = 2550.
    expect(detail!.summary.netPnlCents).toBe(2_550);
    // Chronological order.
    expect(detail!.bankrollHistory.map((p) => p.settledCents)).toEqual([
      START,
      START + 2_000,
    ]);
    expect(detail!.positions).toHaveLength(2);
    expect(detail!.openPositionCount).toBe(1);
    expect(detail!.settledPositionCount).toBe(1);
    // The open position marks at the yes bid; the settled one carries realized P&L.
    const open = detail!.positions.find((p) => p.positionId === "p1")!;
    expect(open.markCents).toBe(55 * 10);
    const settled = detail!.positions.find((p) => p.positionId === "p2")!;
    expect(settled.markCents).toBeNull();
    expect(settled.realizedPnlCents).toBe(300);
    expect(settled.playerName).toBe("Q"); // falls back to kalshi name
    expect(detail!.recentCycles).toHaveLength(1);
    expect(detail!.recentCycles[0].gameLabel).toBe("BUF @ KC");
  });
});
