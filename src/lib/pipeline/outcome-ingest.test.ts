import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * Settlement ingest (SIG-51). Prisma and the Kalshi client are mocked at
 * their seams; the error classes stay real so the degraded path exercises
 * the same instanceof checks production runs.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    contract: { findMany: jest.fn() },
    pipelineRun: { create: jest.fn(), update: jest.fn() },
    outcome: { create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/kalshi/client", () => {
  const actual = jest.requireActual("@/lib/kalshi/client");
  return { ...actual, getMarketsByTickers: jest.fn() };
});

import { prisma } from "@/lib/prisma";
import { getMarketsByTickers } from "@/lib/kalshi/client";
import {
  KalshiUnavailableError,
  KalshiRateLimitError,
} from "@/lib/kalshi/client";
import { Prisma } from "../../../generated/prisma/client";
import {
  mapKalshiResult,
  outcomeIngestInputSchema,
  runOutcomeIngest,
} from "./outcome-ingest";

const mockPrisma = prisma as unknown as {
  contract: { findMany: jest.Mock };
  pipelineRun: { create: jest.Mock; update: jest.Mock };
  outcome: { create: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const mockGetMarkets = getMarketsByTickers as jest.Mock;

const NOW = new Date("2026-01-11T18:00:00Z");
const input = { invocationId: "gh:1:1" };

function contractRow(
  ticker: string,
  outcome: { result: string; recordedAt: Date } | null = null,
) {
  return { id: `contract-${ticker}`, kalshiTicker: ticker, outcome };
}

function primeHappyPath(contracts: unknown[]) {
  mockPrisma.contract.findMany.mockResolvedValue(contracts);
  mockPrisma.pipelineRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.pipelineRun.update.mockResolvedValue({});
  mockPrisma.$transaction.mockResolvedValue([]);
}

describe("mapKalshiResult", () => {
  it("maps the determined results", () => {
    expect(mapKalshiResult("yes")).toBe("yes");
    expect(mapKalshiResult("no")).toBe("no");
  });

  it("maps only an explicit void to voided", () => {
    expect(mapKalshiResult("void")).toBe("voided");
    expect(mapKalshiResult("voided")).toBe("voided");
  });

  it("treats empty — Kalshi's not-settled-yet — as unavailable, never voided", () => {
    expect(mapKalshiResult("")).toBeNull();
    expect(mapKalshiResult(undefined)).toBeNull();
  });

  it("never fabricates a result from an unknown vocabulary entry", () => {
    expect(mapKalshiResult("scalar")).toBeNull();
    expect(mapKalshiResult("all_no")).toBeNull();
  });
});

describe("outcomeIngestInputSchema", () => {
  it("accepts the scheduler report and nothing extra", () => {
    expect(outcomeIngestInputSchema.safeParse(input).success).toBe(true);
    expect(
      outcomeIngestInputSchema.safeParse({ ...input, userId: "u-1" }).success,
    ).toBe(false); // strict: a machine report carries no user identifier
    expect(
      outcomeIngestInputSchema.safeParse({ invocationId: "" }).success,
    ).toBe(false);
  });
});

describe("runOutcomeIngest", () => {
  it("skips as not_expected when nothing awaits settlement — no run row, no Kalshi call", async () => {
    mockPrisma.contract.findMany.mockResolvedValue([]);

    const result = await runOutcomeIngest(input, NOW);

    expect(result).toEqual({
      skipped: "not_expected",
      contractsConsidered: 0,
      outcomesWritten: 0,
      outcomesSuperseded: 0,
      unavailable: 0,
      degraded: false,
    });
    expect(mockPrisma.pipelineRun.create).not.toHaveBeenCalled();
    expect(mockGetMarkets).not.toHaveBeenCalled();
  });

  it("coalesces a re-delivered invocation without contacting Kalshi", async () => {
    mockPrisma.contract.findMany.mockResolvedValue([contractRow("T-A")]);
    mockPrisma.pipelineRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await runOutcomeIngest(input, NOW);

    expect(result.skipped).toBe("coalesced");
    expect(mockGetMarkets).not.toHaveBeenCalled();
    expect(mockPrisma.outcome.create).not.toHaveBeenCalled();
  });

  it("records a new settlement, retained regardless of resolution or projection", async () => {
    primeHappyPath([contractRow("T-A")]);
    mockGetMarkets.mockResolvedValue([
      { ticker: "T-A", result: "yes", settled_time: "2026-01-11T04:00:00Z" },
    ]);

    const result = await runOutcomeIngest(input, NOW);

    expect(result.outcomesWritten).toBe(1);
    expect(result.outcomesSuperseded).toBe(0);
    expect(result.degraded).toBe(false);
    expect(mockPrisma.outcome.create).toHaveBeenCalledWith({
      data: {
        contractId: "contract-T-A",
        result: "yes",
        settledAt: new Date("2026-01-11T04:00:00Z"),
        recordedAt: NOW,
        rawResult: "yes",
      },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "succeeded" }),
      }),
    );
  });

  it("writes nothing when the settlement is unchanged — idempotence by comparison", async () => {
    primeHappyPath([
      contractRow("T-A", {
        result: "yes",
        recordedAt: new Date("2026-01-10T00:00:00Z"),
      }),
    ]);
    mockGetMarkets.mockResolvedValue([{ ticker: "T-A", result: "yes" }]);

    const result = await runOutcomeIngest(input, NOW);

    expect(result.outcomesWritten).toBe(0);
    expect(result.outcomesSuperseded).toBe(0);
    expect(mockPrisma.outcome.create).not.toHaveBeenCalled();
    expect(mockPrisma.outcome.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("supersedes a changed settlement in place with provenance retained", async () => {
    const priorRecordedAt = new Date("2026-01-10T00:00:00Z");
    primeHappyPath([
      contractRow("T-A", { result: "yes", recordedAt: priorRecordedAt }),
    ]);
    mockGetMarkets.mockResolvedValue([{ ticker: "T-A", result: "no" }]);

    const result = await runOutcomeIngest(input, NOW);

    expect(result.outcomesSuperseded).toBe(1);
    expect(result.outcomesWritten).toBe(0);
    expect(mockPrisma.outcome.update).toHaveBeenCalledWith({
      where: { contractId: "contract-T-A" },
      data: {
        result: "no",
        settledAt: null,
        recordedAt: NOW,
        rawResult: "no",
        supersededCount: { increment: 1 },
        previousResult: "yes",
        previousRecordedAt: priorRecordedAt,
      },
    });
  });

  it("counts an unmappable result as unavailable and logs it — never a fabricated row", async () => {
    primeHappyPath([contractRow("T-A"), contractRow("T-B")]);
    mockGetMarkets.mockResolvedValue([
      { ticker: "T-A", result: "scalar" },
      { ticker: "T-B", result: "" }, // not settled yet: unavailable, no note
    ]);

    const result = await runOutcomeIngest(input, NOW);

    expect(result.unavailable).toBe(2);
    expect(result.outcomesWritten).toBe(0);
    expect(mockPrisma.outcome.create).not.toHaveBeenCalled();
    const finish = mockPrisma.pipelineRun.update.mock.calls[0][0];
    expect(finish.data.errorMessage).toContain('unmappable result "scalar"');
    expect(finish.data.status).toBe("succeeded");
  });

  it("counts a ticker Kalshi did not return as unavailable", async () => {
    primeHappyPath([contractRow("T-A")]);
    mockGetMarkets.mockResolvedValue([]);

    const result = await runOutcomeIngest(input, NOW);

    expect(result.unavailable).toBe(1);
    expect(result.outcomesWritten).toBe(0);
  });

  it("keeps partial results and reports degraded when Kalshi fails mid-run", async () => {
    // 101 contracts → two pages. Page one settles; page two hits an outage.
    const contracts = Array.from({ length: 101 }, (_, i) =>
      contractRow(`T-${String(i).padStart(3, "0")}`),
    );
    primeHappyPath(contracts);
    mockGetMarkets
      .mockResolvedValueOnce(
        contracts
          .slice(0, 100)
          .map((contract) => ({ ticker: contract.kalshiTicker, result: "no" })),
      )
      .mockRejectedValueOnce(new KalshiUnavailableError(502));

    const result = await runOutcomeIngest(input, NOW);

    expect(result.degraded).toBe(true);
    expect(result.outcomesWritten).toBe(100);
    expect(result.contractsConsidered).toBe(101);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // A degraded cycle never reads as the last SUCCESSFUL run.
    expect(mockPrisma.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("treats a rate limit like an outage: stop, keep, report degraded", async () => {
    primeHappyPath([contractRow("T-A")]);
    mockGetMarkets.mockRejectedValue(new KalshiRateLimitError());

    const result = await runOutcomeIngest(input, NOW);

    expect(result.degraded).toBe(true);
    expect(result.outcomesWritten).toBe(0);
  });

  it("marks the run failed before propagating an unexpected error", async () => {
    primeHappyPath([contractRow("T-A")]);
    mockGetMarkets.mockRejectedValue(new Error("unexpected"));

    await expect(runOutcomeIngest(input, NOW)).rejects.toThrow("unexpected");
    expect(mockPrisma.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
});

describe("outcome-ingest structure", () => {
  const code = readCode(
    join(process.cwd(), "src", "lib", "pipeline", "outcome-ingest.ts"),
  );

  it("selects with no resolution filter — settlement retention is unconditional", () => {
    expect(code).not.toContain("resolutionStatus");
    expect(code).not.toContain("projection");
  });

  it("records one cycle per [category, invocationId]", () => {
    expect(code).toContain('category: "outcome_ingest"');
    expect(code).toContain("P2002");
  });

  it("measures the change window from stored state, never the calendar", () => {
    expect(code).toContain("SETTLEMENT_CHANGE_WINDOW_DAYS");
    expect(code).toContain("kickoffAt");
  });
});
