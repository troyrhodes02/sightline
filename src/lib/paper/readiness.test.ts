import { prisma } from "@/lib/prisma";
import { REQUIRED_PAPER_WEEKS } from "./config";
import { readReadiness } from "./readiness";
import * as state from "./state";
import * as calibration from "./calibration-window";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paperPosition: { findMany: jest.fn() },
    paperBreach: { findMany: jest.fn() },
    paperCycle: { count: jest.fn(), findMany: jest.fn() },
    backtestRun: { findFirst: jest.fn() },
  },
}));
jest.mock("./state", () => ({ readCampaignState: jest.fn() }));
jest.mock("./calibration-window", () => ({ calibrationSample: jest.fn() }));

const mockPrisma = prisma as unknown as {
  paperPosition: { findMany: jest.Mock };
  paperBreach: { findMany: jest.Mock };
  paperCycle: { count: jest.Mock; findMany: jest.Mock };
  backtestRun: { findFirst: jest.Mock };
};
const mockState = state as unknown as { readCampaignState: jest.Mock };
const mockCalibration = calibration as unknown as {
  calibrationSample: jest.Mock;
};

const NOW = new Date("2026-11-10T12:00:00Z");

/** A campaign whose model-quality and safety evidence is all healthy. */
function healthyCampaign() {
  mockState.readCampaignState.mockResolvedValue({
    campaignId: "c1",
    startingBankrollCents: 100_000,
    autonomyEnabled: true,
    killSwitchEngaged: false,
    highWaterMarkCents: 100_000,
    settledBalanceCents: 106_000,
    openExposureCents: 0,
    mark: { available: true, markCents: 106_000, openValueCents: 0 },
    activeBankrollCents: 106_000,
    drawdownBps: 0,
    slateCapacityCents: 15_900,
    gameCapacityCents: 5_300,
    riskConfig: {
      id: "rc1",
      mode: "conservative",
      kellyFraction: 0.25,
      perGameCapPct: 5,
      perSlateCapPct: 15,
      drawdownWarnPct: 5,
      drawdownHaltPct: 10,
      probabilityCeiling: 0.75,
      withdrawalCeilingMultiple: 1.5,
    },
    currentBreaches: [],
  });
  mockCalibration.calibrationSample.mockResolvedValue({
    rollingBrier: 0.215,
    backtestBrier: 0.213,
    marketBrier: 0.221,
    modelBrierOnMarketContracts: 0.215,
    observations: 118,
    marketObservations: 118,
  });
  mockPrisma.backtestRun.findFirst.mockResolvedValue({
    label: "2019–2024 holdout",
    seasonFrom: 2019,
    seasonTo: 2024,
    aggregates: {},
  });
  mockPrisma.paperBreach.findMany.mockResolvedValue([]);
  mockPrisma.paperCycle.count.mockResolvedValue(0);
  mockPrisma.paperCycle.findMany.mockResolvedValue([]);
}

/** `count` settled positions across `weeks` distinct NFL weeks. */
function positionsAcross(weeks: number, pnlPerWeekCents: number) {
  const rows = [];
  for (let week = 1; week <= weeks; week += 1) {
    rows.push({
      status: "settled_won",
      realizedPnlCents: pnlPerWeekCents,
      contract: { game: { season: 2026, week } },
    });
  }
  mockPrisma.paperPosition.findMany.mockResolvedValue(rows);
}

beforeEach(() => {
  jest.clearAllMocks();
  healthyCampaign();
  mockPrisma.paperPosition.findMany.mockResolvedValue([]);
});

describe("the two-week gate cannot be shortened", () => {
  it("reports paper_evidence_building on ONE excellent complete week", async () => {
    // The pitch's explicit warning: a short profitable stretch is not proof.
    // Every other criterion here is healthy and the week is strongly positive.
    positionsAcross(1, 25_000);

    const readiness = await readReadiness(NOW);

    expect(readiness.state).toBe("paper_evidence_building");
    expect(readiness.weeksComplete).toBe(1);
    expect(readiness.criteria.find((c) => c.key === "two_weeks")?.met).toBe(
      false,
    );
    // Even the P&L criterion is unmet, because the weeks it would be measured
    // across do not exist yet.
    expect(readiness.criteria.find((c) => c.key === "positive_pnl")?.met).toBe(
      false,
    );
  });

  it("reports eligible only once two complete weeks are positive", async () => {
    positionsAcross(REQUIRED_PAPER_WEEKS, 3_000);

    const readiness = await readReadiness(NOW);

    expect(readiness.weeksComplete).toBe(REQUIRED_PAPER_WEEKS);
    expect(readiness.state).toBe("eligible_for_live_trading");
  });

  it("refuses eligibility on two complete but unprofitable weeks", async () => {
    positionsAcross(REQUIRED_PAPER_WEEKS, -4_000);

    const readiness = await readReadiness(NOW);

    expect(readiness.state).toBe("paper_evidence_building");
    expect(readiness.criteria.find((c) => c.key === "positive_pnl")?.met).toBe(
      false,
    );
  });

  it("does not count a week whose positions are still open", async () => {
    mockPrisma.paperPosition.findMany.mockResolvedValue([
      {
        status: "settled_won",
        realizedPnlCents: 5_000,
        contract: { game: { season: 2026, week: 9 } },
      },
      {
        status: "open",
        realizedPnlCents: null,
        contract: { game: { season: 2026, week: 10 } },
      },
    ]);

    const readiness = await readReadiness(NOW);

    expect(readiness.weeksComplete).toBe(1);
    expect(readiness.state).toBe("paper_evidence_building");
  });

  it("reports not_ready before any week completes", async () => {
    const readiness = await readReadiness(NOW);
    expect(readiness.state).toBe("not_ready");
    expect(readiness.weeksRequired).toBe(2);
  });
});

describe("an unevaluable criterion is never met", () => {
  it("marks calibration unevaluable below the observation minimum", async () => {
    positionsAcross(2, 3_000);
    mockCalibration.calibrationSample.mockResolvedValue({
      rollingBrier: 0.2,
      backtestBrier: 0.213,
      marketBrier: 0.221,
      modelBrierOnMarketContracts: 0.2,
      observations: 12,
      marketObservations: 12,
    });

    const readiness = await readReadiness(NOW);
    const criterion = readiness.criteria.find((c) => c.key === "calibration");

    expect(criterion?.unevaluable).toBe(true);
    expect(criterion?.met).toBe(false);
    expect(criterion?.evidence).toContain("12 graded predictions");
    // And it blocks eligibility rather than being skipped.
    expect(readiness.state).not.toBe("eligible_for_live_trading");
  });

  it("marks the market comparison unevaluable with no market Brier", async () => {
    positionsAcross(2, 3_000);
    mockCalibration.calibrationSample.mockResolvedValue({
      rollingBrier: 0.2,
      backtestBrier: 0.213,
      marketBrier: null,
      modelBrierOnMarketContracts: null,
      observations: 118,
      marketObservations: 0,
    });

    const readiness = await readReadiness(NOW);
    const criterion = readiness.criteria.find(
      (c) => c.key === "market_relative",
    );
    expect(criterion?.unevaluable).toBe(true);
    expect(criterion?.met).toBe(false);
  });

  it("marks baselines unevaluable with no completed holdout run", async () => {
    positionsAcross(2, 3_000);
    mockPrisma.backtestRun.findFirst.mockResolvedValue(null);

    const readiness = await readReadiness(NOW);
    expect(
      readiness.criteria.find((c) => c.key === "baselines")?.unevaluable,
    ).toBe(true);
  });

  it("marks drawdown unevaluable when mark-to-market is unavailable", async () => {
    positionsAcross(2, 3_000);
    mockState.readCampaignState.mockResolvedValue({
      ...(await mockState.readCampaignState()),
      drawdownBps: null,
    });

    const readiness = await readReadiness(NOW);
    const criterion = readiness.criteria.find((c) => c.key === "drawdown");
    expect(criterion?.unevaluable).toBe(true);
    expect(criterion?.evidence).toContain("mark-to-market unavailable");
  });
});

describe("safety and operations criteria", () => {
  it("fails on an unresolved breach", async () => {
    positionsAcross(2, 3_000);
    mockPrisma.paperBreach.findMany.mockResolvedValue([
      { resolution: "active" },
    ]);

    const readiness = await readReadiness(NOW);
    expect(readiness.criteria.find((c) => c.key === "breakers")?.met).toBe(
      false,
    );
    expect(readiness.state).not.toBe("eligible_for_live_trading");
  });

  it("keeps a force override visible without failing the criterion", async () => {
    // An override is not a failure of the breaker; it is a recorded human
    // decision. The evidence line keeps it visible either way.
    positionsAcross(2, 3_000);
    mockPrisma.paperBreach.findMany.mockResolvedValue([
      { resolution: "force_overridden" },
      { resolution: "cleared" },
    ]);

    const readiness = await readReadiness(NOW);
    const criterion = readiness.criteria.find((c) => c.key === "breakers");
    expect(criterion?.met).toBe(true);
    expect(criterion?.evidence).toContain("1 force override");
  });

  it("fails on a recent failed cycle", async () => {
    positionsAcross(2, 3_000);
    mockPrisma.paperCycle.count.mockResolvedValue(2);

    const readiness = await readReadiness(NOW);
    expect(readiness.criteria.find((c) => c.key === "operations")?.met).toBe(
      false,
    );
  });

  it("fails when a stored cycle shows a fill beyond its cap", async () => {
    positionsAcross(2, 3_000);
    mockPrisma.paperCycle.findMany.mockResolvedValue([
      {
        stakedCents: 20_000,
        gameCapacityCents: 5_000,
        slateCapacityCents: 15_000,
        candidates: [],
      },
    ]);

    const readiness = await readReadiness(NOW);
    expect(readiness.criteria.find((c) => c.key === "sizing")?.met).toBe(false);
  });
});

describe("the disclaimer", () => {
  it("renders in every state and is stronger when eligible", async () => {
    const notReady = await readReadiness(NOW);
    expect(notReady.disclaimer).toContain("does not enable live trading");

    positionsAcross(2, 3_000);
    const eligible = await readReadiness(NOW);
    expect(eligible.state).toBe("eligible_for_live_trading");
    expect(eligible.disclaimer).toContain("This is a report, not an action");
    expect(eligible.disclaimer).toContain("cannot move itself to real money");
  });
});
