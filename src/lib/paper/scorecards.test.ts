import { prisma } from "@/lib/prisma";
import { periodWindowStart, readPortfolioScorecards } from "./scorecards";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paperCampaign: { findMany: jest.fn() },
    paperLedgerEntry: { findFirst: jest.fn(), aggregate: jest.fn() },
    paperPosition: { findMany: jest.fn(), count: jest.fn() },
    priceObservation: { findMany: jest.fn() },
    paperCycle: { aggregate: jest.fn() },
    paperBreach: { count: jest.fn() },
    paperRiskConfig: { findFirst: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  paperCampaign: { findMany: jest.Mock };
  paperLedgerEntry: { findFirst: jest.Mock; aggregate: jest.Mock };
  paperPosition: { findMany: jest.Mock; count: jest.Mock };
  priceObservation: { findMany: jest.Mock };
  paperCycle: { aggregate: jest.Mock };
  paperBreach: { count: jest.Mock };
  paperRiskConfig: { findFirst: jest.Mock };
};

const NOW = new Date("2026-11-15T12:00:00Z");
const START = 100_000;

/**
 * Three portfolios, each priced by its own calls. The mock keys the per-portfolio
 * reads on the campaignId argument so the three cannot bleed into one another —
 * which is exactly the independence D5/D11 require.
 */
function threePortfolios(overrides?: {
  markUnavailable?: Set<string>;
  cycleAgg?: Record<string, { evaluated: number; sized: number }>;
  positions?: Record<string, number>;
  settled?: Record<string, number>;
}) {
  const ids = { baseline: "cb", simulation: "cs", hybrid: "ch" };
  mockPrisma.paperCampaign.findMany.mockResolvedValue([
    // deliberately out of order to prove the read sorts
    {
      id: ids.hybrid,
      portfolio: "hybrid",
      startingBankrollCents: START,
      highWaterMarkCents: START,
    },
    {
      id: ids.baseline,
      portfolio: "baseline",
      startingBankrollCents: START,
      highWaterMarkCents: START,
    },
    {
      id: ids.simulation,
      portfolio: "simulation",
      startingBankrollCents: START,
      highWaterMarkCents: START,
    },
  ]);

  mockPrisma.paperLedgerEntry.findFirst.mockImplementation(
    async ({ where }: { where: { campaignId: string } }) => ({
      balanceAfterCents: overrides?.settled?.[where.campaignId] ?? START,
    }),
  );
  mockPrisma.paperLedgerEntry.aggregate.mockResolvedValue({
    _sum: { amountCents: 0 },
  });
  // No open positions → mark-to-market is trivially available (markCents =
  // settled), unless a portfolio is forced degraded below.
  mockPrisma.paperPosition.findMany.mockResolvedValue([]);
  mockPrisma.priceObservation.findMany.mockResolvedValue([]);
  mockPrisma.paperPosition.count.mockImplementation(
    async ({ where }: { where: { campaignId: string } }) =>
      overrides?.positions?.[where.campaignId] ?? 0,
  );
  mockPrisma.paperCycle.aggregate.mockImplementation(
    async ({ where }: { where: { campaignId: string } }) => {
      const agg = overrides?.cycleAgg?.[where.campaignId] ?? {
        evaluated: 0,
        sized: 0,
      };
      return {
        _sum: {
          candidatesEvaluated: agg.evaluated,
          candidatesSized: agg.sized,
        },
      };
    },
  );
  mockPrisma.paperBreach.count.mockResolvedValue(0);
  mockPrisma.paperRiskConfig.findFirst.mockResolvedValue({
    mode: "conservative",
  });
  return ids;
}

describe("readPortfolioScorecards", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns one scorecard per portfolio, baseline → simulation → hybrid", async () => {
    threePortfolios();
    const cards = await readPortfolioScorecards("ec1", "campaign", NOW);
    expect(cards.map((c) => c.portfolio)).toEqual([
      "baseline",
      "simulation",
      "hybrid",
    ]);
  });

  it("carries per-portfolio opportunity counts that may differ (D5)", async () => {
    const ids = threePortfolios({
      cycleAgg: {
        cb: { evaluated: 40, sized: 12 },
        cs: { evaluated: 40, sized: 20 },
        ch: { evaluated: 40, sized: 16 },
      },
    });
    const cards = await readPortfolioScorecards("ec1", "campaign", NOW);
    const byPortfolio = Object.fromEntries(cards.map((c) => [c.portfolio, c]));
    expect(byPortfolio.baseline.candidatesEvaluated).toBe(40);
    expect(byPortfolio.baseline.candidatesSized).toBe(12);
    expect(byPortfolio.simulation.candidatesSized).toBe(20);
    expect(byPortfolio.hybrid.candidatesSized).toBe(16);
    // Every scorecard carries both opportunity counts — never a bankroll figure
    // without them.
    for (const card of cards) {
      expect(typeof card.candidatesEvaluated).toBe("number");
      expect(typeof card.candidatesSized).toBe("number");
    }
    void ids;
  });

  it("accumulates each portfolio independently under identical assumptions", async () => {
    // Same starting bankroll, same risk mode; different settled balances prove
    // the ledgers are read separately and never summed.
    threePortfolios({
      settled: { cb: START + 6_000, cs: START - 2_000, ch: START + 1_000 },
    });
    const cards = await readPortfolioScorecards("ec1", "campaign", NOW);
    const byPortfolio = Object.fromEntries(cards.map((c) => [c.portfolio, c]));
    expect(byPortfolio.baseline.netPnlCents).toBe(6_000);
    expect(byPortfolio.simulation.netPnlCents).toBe(-2_000);
    expect(byPortfolio.hybrid.netPnlCents).toBe(1_000);
    // All start from the same bankroll — identical assumptions.
    for (const card of cards) {
      expect(card.startingBankrollCents).toBe(START);
      expect(card.riskMode).toBe("conservative");
    }
  });

  it("reports null (not 0) for mark-dependent figures when the mark is degraded", async () => {
    threePortfolios();
    // Force one portfolio's open position to have no bid → mark unavailable.
    mockPrisma.paperPosition.findMany.mockImplementation(
      async ({ where }: { where: { campaignId: string; status: string } }) => {
        if (where.campaignId === "cs" && where.status === "open") {
          return [
            {
              id: "p1",
              contractId: "k1",
              side: "yes",
              contracts: 10,
              costBasisCents: 500,
              feesPaidCents: 5,
            },
          ];
        }
        return [];
      },
    );
    mockPrisma.priceObservation.findMany.mockResolvedValue([]); // no bid for k1

    const cards = await readPortfolioScorecards("ec1", "campaign", NOW);
    const sim = cards.find((c) => c.portfolio === "simulation")!;
    expect(sim.activeBankrollCents).toBeNull();
    expect(sim.totalValueCents).toBeNull();
    expect(sim.netPnlCents).toBeNull();
    expect(sim.returnPct).toBeNull();
    expect(sim.maxDrawdownBps).toBeNull();
    // The healthy portfolios still report numbers — a degraded mark on one
    // portfolio does not poison another.
    const base = cards.find((c) => c.portfolio === "baseline")!;
    expect(base.activeBankrollCents).toBe(START);
  });

  it("windows opportunity aggregates by period without resetting bankroll", async () => {
    // The period passes a startedAt window to the cycle aggregate but NEVER
    // changes the ledger read (which has no window). We assert the window is
    // applied to cycles/positions and the P&L still measures against the true
    // starting bankroll.
    threePortfolios({ settled: { cb: START + 3_000, cs: START, ch: START } });
    await readPortfolioScorecards("ec1", "two_week", NOW);

    const cycleCall = mockPrisma.paperCycle.aggregate.mock.calls[0][0];
    expect(cycleCall.where.startedAt).toBeDefined();
    expect(cycleCall.where.startedAt.gte).toEqual(
      periodWindowStart("two_week", NOW),
    );

    // Ledger read carries no window — bankroll is continuous.
    const ledgerCall = mockPrisma.paperLedgerEntry.findFirst.mock.calls[0][0];
    expect(ledgerCall.where.startedAt).toBeUndefined();

    // And the campaign period applies no window at all.
    jest.clearAllMocks();
    threePortfolios();
    await readPortfolioScorecards("ec1", "campaign", NOW);
    const campaignCycleCall = mockPrisma.paperCycle.aggregate.mock.calls[0][0];
    expect(campaignCycleCall.where.startedAt).toBeUndefined();
  });

  it("computes P&L against the true starting bankroll regardless of period", async () => {
    // Same underlying campaign, two periods: the netPnl is identical because it
    // is measured against the real start and current mark, not a windowed
    // opening balance.
    threePortfolios({ settled: { cb: START + 5_000, cs: START, ch: START } });
    const campaign = await readPortfolioScorecards("ec1", "campaign", NOW);
    jest.clearAllMocks();
    threePortfolios({ settled: { cb: START + 5_000, cs: START, ch: START } });
    const twoWeek = await readPortfolioScorecards("ec1", "two_week", NOW);

    const base = (list: Awaited<ReturnType<typeof readPortfolioScorecards>>) =>
      list.find((c) => c.portfolio === "baseline")!;
    expect(base(campaign).netPnlCents).toBe(5_000);
    expect(base(twoWeek).netPnlCents).toBe(5_000);
  });

  it("reads ONLY the comparison bots so Model Performance stays a 3-way comparison", async () => {
    // Paper Bot Lab: custom bots share the campaign but must never appear on Model
    // Performance. The scorecard read filters isComparison=true.
    threePortfolios();
    await readPortfolioScorecards("ec1", "campaign", NOW);
    expect(mockPrisma.paperCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { evaluationCampaignId: "ec1", isComparison: true },
      }),
    );
  });

  it("omits Hybrid when only two portfolios exist (no hybrid selection, D11)", async () => {
    mockPrisma.paperCampaign.findMany.mockResolvedValue([
      {
        id: "cb",
        portfolio: "baseline",
        startingBankrollCents: START,
        highWaterMarkCents: START,
      },
      {
        id: "cs",
        portfolio: "simulation",
        startingBankrollCents: START,
        highWaterMarkCents: START,
      },
    ]);
    mockPrisma.paperLedgerEntry.findFirst.mockResolvedValue({
      balanceAfterCents: START,
    });
    mockPrisma.paperLedgerEntry.aggregate.mockResolvedValue({
      _sum: { amountCents: 0 },
    });
    mockPrisma.paperPosition.findMany.mockResolvedValue([]);
    mockPrisma.priceObservation.findMany.mockResolvedValue([]);
    mockPrisma.paperPosition.count.mockResolvedValue(0);
    mockPrisma.paperCycle.aggregate.mockResolvedValue({
      _sum: { candidatesEvaluated: 0, candidatesSized: 0 },
    });
    mockPrisma.paperBreach.count.mockResolvedValue(0);
    mockPrisma.paperRiskConfig.findFirst.mockResolvedValue({
      mode: "moderate",
    });

    const cards = await readPortfolioScorecards("ec1", "campaign", NOW);
    expect(cards.map((c) => c.portfolio)).toEqual(["baseline", "simulation"]);
  });
});
