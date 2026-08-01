import { join } from "node:path";
import { productionFiles, readCode } from "@/lib/testing/source";

/**
 * Prisma is mocked at the seam: these tests exercise derivation, ordering,
 * and honesty of the read against controlled run records, without a database.
 * The pure state rules have their own suite in `derive.test.ts`.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    game: { findMany: jest.fn() },
    pipelineRun: { findFirst: jest.fn() },
    marketSyncRun: { findFirst: jest.fn() },
    ingestRun: { findMany: jest.fn() },
    pipelineRunGame: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { readHealth } from "./read";

const mockPrisma = prisma as unknown as {
  game: { findMany: jest.Mock };
  pipelineRun: { findFirst: jest.Mock };
  marketSyncRun: { findFirst: jest.Mock };
  ingestRun: { findMany: jest.Mock };
  pipelineRunGame: { findMany: jest.Mock };
};

function emptyDb() {
  mockPrisma.game.findMany.mockResolvedValue([]);
  mockPrisma.pipelineRun.findFirst.mockResolvedValue(null);
  mockPrisma.marketSyncRun.findFirst.mockResolvedValue(null);
  mockPrisma.ingestRun.findMany.mockResolvedValue([]);
  mockPrisma.pipelineRunGame.findMany.mockResolvedValue([]);
}

describe("health read", () => {
  beforeEach(() => {
    emptyDb();
  });

  it("reports the three signals in fixed order", async () => {
    const { signals } = await readHealth();
    expect(signals.map((s) => s.key)).toEqual([
      "ingest",
      "recompute",
      "price_refresh",
    ]);
    expect(signals.map((s) => s.label)).toEqual([
      "Ingest",
      "Projection recomputation",
      "Price refresh",
    ]);
  });

  it("derives not_expected for every signal when the schedule holds no upcoming game", async () => {
    const { signals, offseason } = await readHealth();
    for (const signal of signals) {
      expect(signal.state).toBe("not_expected");
      // Dormant signals carry no expected-window sentence — old timestamps
      // under `not expected` are correct, not late.
      expect(signal.expectedWithin).toBeNull();
    }
    expect(offseason).not.toBeNull();
  });

  it("fabricates no timestamp when nothing has ever run", async () => {
    const { signals, offseason } = await readHealth();
    for (const signal of signals) {
      expect(signal.lastSuccessAt).toBeNull();
      expect(signal.lastSuccessAge).toBeNull();
      expect(signal.lastAttemptAt).toBeNull();
      expect(signal.lastAttemptOutcome).toBeNull();
    }
    expect(offseason?.keepalive.lastActedAt).toBeNull();
    expect(offseason?.keepalive.nextRequiredBy).toBeNull();
    expect(offseason?.keepalive.overdue).toBe(false);
  });

  it("stays in-season (offseason null) when a kickoff is upcoming", async () => {
    mockPrisma.game.findMany.mockResolvedValue([
      { kickoffAt: new Date(Date.now() + 24 * 60 * 60_000) },
    ]);
    const { signals, offseason } = await readHealth();
    expect(offseason).toBeNull();
    // Expected but nothing recorded yet: the honest state is never_run.
    for (const signal of signals) {
      expect(signal.state).toBe("never_run");
    }
  });

  it("moves the last-success signal only for completed successful runs", async () => {
    const success = new Date(Date.now() - 5 * 60 * 60_000);
    mockPrisma.game.findMany.mockResolvedValue([
      { kickoffAt: new Date(Date.now() + 24 * 60 * 60_000) },
    ]);
    // Latest attempt failed; latest success is older. The signal must read
    // failed while still displaying the older success — an attempt is never
    // presented as a success.
    mockPrisma.pipelineRun.findFirst.mockImplementation(
      ({ where }: { where: { status?: string } }) =>
        Promise.resolve(
          where.status === "succeeded"
            ? {
                id: "s",
                status: "succeeded",
                startedAt: success,
                finishedAt: success,
              }
            : {
                id: "f",
                status: "failed",
                startedAt: new Date(Date.now() - 60_000),
                finishedAt: new Date(Date.now() - 30_000),
              },
        ),
    );
    const { signals } = await readHealth();
    const ingest = signals[0];
    expect(ingest.state).toBe("failed");
    expect(ingest.lastSuccessAt).not.toBeNull();
    expect(ingest.lastAttemptOutcome).toBe("failed");
  });
});

describe("health reads only pipeline-linked run records", () => {
  // Standalone `IngestRun` rows exist from Pitch 1's manual backfills. A
  // hand-run backfill is not evidence that the *scheduled* pipeline works —
  // the false green this surface has refused since SIG-37. The only sanctioned
  // ingest_runs read is the per-source detail of a specific cycle.
  it("queries ingest runs only by owning pipeline run", () => {
    const health = productionFiles(join(process.cwd(), "src", "lib", "health"));
    const read = health.find((f) => f.endsWith("read.ts"));
    expect(read).toBeDefined();

    const code = readCode(read!);
    const ingestRunQueries = code.match(/prisma\.ingestRun\.\w+/g) ?? [];
    expect(ingestRunQueries).toEqual(["prisma.ingestRun.findMany"]);
    expect(code).toMatch(
      /ingestRun\.findMany\(\{\s*where:\s*\{\s*pipelineRunId/,
    );
  });

  it("never mutates — the surface reports, it does not operate", () => {
    const health = productionFiles(join(process.cwd(), "src", "lib", "health"));
    for (const file of health) {
      const code = readCode(file);
      expect(code).not.toMatch(/\.(create|update|upsert|delete)\w*\(/);
    }
  });
});
