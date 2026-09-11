import { prisma } from "@/lib/prisma";
import {
  ModelSelectionError,
  activeConfigurationPortfolio,
  applyModelSelection,
} from "./model-selection";
import type { StatType } from "../../../generated/prisma/enums";

jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: jest.fn() },
}));

const mockPrisma = prisma as unknown as { $transaction: jest.Mock };

const NOW = new Date("2026-11-15T17:00:00Z");
const BASELINE = "baseline-zil-0.1.0";
const SIMULATION = "simulation-mc-0.1.0";

/**
 * A campaign whose active configuration is currently Simulation-only (every stat
 * on Simulation). The switch under test makes receiving-yards Baseline, which
 * turns the active configuration Hybrid — so the clock must reset against the
 * Hybrid portfolio, not Simulation's.
 */
function transaction(options: {
  /** The per-stat selection AFTER the write is applied. */
  selectionAfter: Array<{ statType: string; modelVersion: string }>;
  /** Portfolios that already exist, keyed by portfolio name. */
  existingPortfolios: Record<string, { id: string } | undefined>;
}) {
  const upserts: Array<{ statType: string; modelVersion: string }> = [];
  const campaignUpdates: Array<Record<string, unknown>> = [];
  const portfolioUpdates: Array<{ id: string; data: Record<string, unknown> }> =
    [];
  const portfolioCreates: Array<Record<string, unknown>> = [];
  const controlEvents: Array<Record<string, unknown>> = [];

  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)({
      paperEvaluationCampaign: {
        findFirst: jest.fn().mockResolvedValue({ id: "ec1" }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ startingBankrollCents: 100_000 }),
        update: jest.fn().mockImplementation(async (args: never) => {
          campaignUpdates.push(
            (args as { data: Record<string, unknown> }).data,
          );
        }),
      },
      modelSelection: {
        upsert: jest.fn().mockImplementation(async (args: never) => {
          const call = args as {
            create: { statType: string; modelVersion: string };
          };
          upserts.push(call.create);
        }),
        findMany: jest.fn().mockResolvedValue(options.selectionAfter),
      },
      paperCampaign: {
        findUnique: jest.fn().mockImplementation(async (args: never) => {
          const call = args as {
            where: { evaluationCampaignId_portfolio: { portfolio: string } };
          };
          return (
            options.existingPortfolios[
              call.where.evaluationCampaignId_portfolio.portfolio
            ] ?? null
          );
        }),
        findFirst: jest.fn().mockResolvedValue({ autonomyEnabled: false }),
        update: jest.fn().mockImplementation(async (args: never) => {
          const call = args as {
            where: { id: string };
            data: Record<string, unknown>;
          };
          portfolioUpdates.push({ id: call.where.id, data: call.data });
        }),
        create: jest.fn().mockImplementation(async (args: never) => {
          const call = args as { data: Record<string, unknown> };
          portfolioCreates.push(call.data);
          return { id: "created-portfolio" };
        }),
      },
      paperControlEvent: {
        create: jest.fn().mockImplementation(async (args: never) => {
          controlEvents.push((args as { data: Record<string, unknown> }).data);
        }),
      },
    }),
  );

  return {
    upserts,
    campaignUpdates,
    portfolioUpdates,
    portfolioCreates,
    controlEvents,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("activeConfigurationPortfolio", () => {
  function map(entries: Array<[string, string]>): Map<StatType, string> {
    return new Map(entries as Array<[StatType, string]>);
  }

  it("is hybrid when the selection names more than one model version", () => {
    expect(
      activeConfigurationPortfolio(
        map([
          ["receiving_yards", BASELINE],
          ["rushing_yards", SIMULATION],
        ]),
      ),
    ).toBe("hybrid");
  });

  it("is simulation when every stat is on Simulation", () => {
    expect(
      activeConfigurationPortfolio(
        map([
          ["receiving_yards", SIMULATION],
          ["rushing_yards", SIMULATION],
        ]),
      ),
    ).toBe("simulation");
  });

  it("is baseline when uniformly baseline or empty", () => {
    expect(
      activeConfigurationPortfolio(map([["receiving_yards", BASELINE]])),
    ).toBe("baseline");
    expect(activeConfigurationPortfolio(map([]))).toBe("baseline");
  });
});

describe("applyModelSelection — the only production-config write", () => {
  it("rejects Simulation for a stat it does not price (invalid_model_for_stat)", async () => {
    transaction({ selectionAfter: [], existingPortfolios: {} });
    await expect(
      applyModelSelection({
        statType: "receiving_tds",
        modelVersion: SIMULATION,
        actorUserId: "u1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "invalid_model_for_stat" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown model version", async () => {
    await expect(
      applyModelSelection({
        statType: "receiving_yards",
        modelVersion: "made-up-1.0.0",
        actorUserId: "u1",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ModelSelectionError);
  });

  it("resets the newly-active HYBRID portfolio's clock, not Simulation's (D2)", async () => {
    // Switching receiving-yards from Simulation to Baseline while other stats
    // stay on Simulation makes the active configuration Hybrid. The clock resets
    // against Hybrid's own portfolio; Simulation's evidence does not transfer.
    const captured = transaction({
      selectionAfter: [
        { statType: "receiving_yards", modelVersion: BASELINE },
        { statType: "rushing_yards", modelVersion: SIMULATION },
      ],
      existingPortfolios: {
        baseline: { id: "p-baseline" },
        simulation: { id: "p-simulation" },
        hybrid: { id: "p-hybrid" },
      },
    });

    const result = await applyModelSelection({
      statType: "receiving_yards",
      modelVersion: BASELINE,
      actorUserId: "u1",
      now: NOW,
    });

    expect(result.activeConfigurationPortfolio).toBe("hybrid");
    // The selection was written.
    expect(captured.upserts[0]).toMatchObject({
      statType: "receiving_yards",
      modelVersion: BASELINE,
    });
    // The evaluation campaign's activeConfigChangedAt was stamped.
    expect(captured.campaignUpdates[0]).toMatchObject({
      activeConfigChangedAt: NOW,
    });
    // The HYBRID portfolio's clock reset — and ONLY it.
    expect(captured.portfolioUpdates).toEqual([
      { id: "p-hybrid", data: { portfolioStartedAt: NOW } },
    ]);
    // A config_changed audit event on the hybrid portfolio.
    expect(captured.controlEvents[0]).toMatchObject({
      campaignId: "p-hybrid",
      kind: "config_changed",
    });
  });

  it("provisions the newly-active portfolio if it does not yet exist, and resets its clock", async () => {
    // A switch that first creates a hybrid configuration provisions the hybrid
    // portfolio so the clock has an anchor.
    const captured = transaction({
      selectionAfter: [
        { statType: "receiving_yards", modelVersion: BASELINE },
        { statType: "rushing_yards", modelVersion: SIMULATION },
      ],
      existingPortfolios: {
        baseline: { id: "p-baseline" },
        simulation: { id: "p-simulation" },
        hybrid: undefined,
      },
    });

    await applyModelSelection({
      statType: "receiving_yards",
      modelVersion: BASELINE,
      actorUserId: "u1",
      now: NOW,
    });

    // Created with its clock starting now — no prior evidence transfers.
    expect(captured.portfolioCreates[0]).toMatchObject({
      portfolio: "hybrid",
      portfolioStartedAt: NOW,
    });
    expect(captured.portfolioUpdates).toEqual([]);
    expect(captured.controlEvents[0]).toMatchObject({
      campaignId: "created-portfolio",
      kind: "config_changed",
    });
  });
});
