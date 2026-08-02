import { join } from "node:path";
import { productionFiles, readCode } from "@/lib/testing/source";

/**
 * Prisma is mocked at the seam: these tests exercise derivation, ordering,
 * and honesty of the read against controlled run records, without a database.
 * The pure state rules have their own suite in `derive.test.ts`.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    game: { findMany: jest.fn() },
    pipelineRun: { findFirst: jest.fn() },
    marketSyncRun: { findFirst: jest.fn() },
    ingestRun: { findMany: jest.fn() },
    pipelineRunGame: { findMany: jest.fn() },
    contract: { count: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { readHealth } from "./read";

const mockPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
  game: { findMany: jest.Mock };
  pipelineRun: { findFirst: jest.Mock };
  marketSyncRun: { findFirst: jest.Mock };
  ingestRun: { findMany: jest.Mock };
  pipelineRunGame: { findMany: jest.Mock };
  contract: { count: jest.Mock };
};

function emptyDb() {
  mockPrisma.game.findMany.mockResolvedValue([]);
  mockPrisma.pipelineRun.findFirst.mockResolvedValue(null);
  mockPrisma.marketSyncRun.findFirst.mockResolvedValue(null);
  mockPrisma.ingestRun.findMany.mockResolvedValue([]);
  mockPrisma.pipelineRunGame.findMany.mockResolvedValue([]);
  // No settlement candidates and no grading work: the post-pipeline jobs are
  // dormant unless a test says otherwise.
  mockPrisma.contract.count.mockResolvedValue(0);
  mockPrisma.$queryRaw.mockResolvedValue([
    { awaiting_games: 0, pending_units: 0 },
  ]);
}

/** Routes `pipelineRun.findFirst` per category/status, defaulting to null. */
function routePipelineRuns(
  rows: Record<
    string,
    { attempt?: Record<string, unknown>; success?: Record<string, unknown> }
  >,
) {
  mockPrisma.pipelineRun.findFirst.mockImplementation(
    ({ where }: { where: { category: string; status?: string } }) => {
      const entry = rows[where.category];
      if (!entry) return Promise.resolve(null);
      return Promise.resolve(
        (where.status === "succeeded" ? entry.success : entry.attempt) ?? null,
      );
    },
  );
}

function run(status: string, finishedHoursAgo: number) {
  const finishedAt = new Date(Date.now() - finishedHoursAgo * 60 * 60_000);
  return {
    id: `${status}-${finishedHoursAgo}`,
    status,
    startedAt: new Date(finishedAt.getTime() - 5 * 60_000),
    finishedAt,
  };
}

describe("health read", () => {
  beforeEach(() => {
    emptyDb();
  });

  it("reports the five signals in fixed order", async () => {
    const { signals } = await readHealth();
    expect(signals.map((s) => s.key)).toEqual([
      "ingest",
      "recompute",
      "price_refresh",
      "outcome_ingest",
      "grading",
    ]);
    expect(signals.map((s) => s.label)).toEqual([
      "Ingest",
      "Projection recomputation",
      "Price refresh",
      "Outcome ingest",
      "Grading",
    ]);
  });

  it("derives not_expected for every signal when schedule and backlog are both empty", async () => {
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
    // Expected but nothing recorded yet: the honest state is never_run for
    // the schedule-driven signals. The post-game jobs are work-driven, and an
    // upcoming kickoff is not pending settlement or grading work.
    for (const signal of signals.slice(0, 3)) {
      expect(signal.state).toBe("never_run");
    }
    for (const signal of signals.slice(3)) {
      expect(signal.state).toBe("not_expected");
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

describe("outcome ingest signal — expectedness is the job's own selection", () => {
  beforeEach(() => {
    emptyDb();
  });

  it("is judged against its bound while settlement candidates exist", async () => {
    mockPrisma.contract.count.mockResolvedValue(4);
    routePipelineRuns({
      outcome_ingest: {
        attempt: run("succeeded", 4),
        success: run("succeeded", 4),
      },
    });
    const { signals } = await readHealth();
    const outcome = signals.find((s) => s.key === "outcome_ingest")!;
    // Hourly cadence, 3h bound: a 4h-old success with work pending is late.
    expect(outcome.state).toBe("late");
    expect(outcome.expectedWithin).toBe("3h of the last success");
  });

  it("reads ok with a fresh success while work is pending", async () => {
    mockPrisma.contract.count.mockResolvedValue(4);
    routePipelineRuns({
      outcome_ingest: {
        attempt: run("succeeded", 1),
        success: run("succeeded", 1),
      },
    });
    const { signals } = await readHealth();
    expect(signals.find((s) => s.key === "outcome_ingest")!.state).toBe("ok");
  });

  it("goes dormant — never late — on a settled-out day with no candidates", async () => {
    // The job records no run row for an empty selection (SIG-51), so an old
    // success with nothing to check is dormancy, not lateness.
    mockPrisma.contract.count.mockResolvedValue(0);
    routePipelineRuns({
      outcome_ingest: {
        attempt: run("succeeded", 90),
        success: run("succeeded", 90),
      },
    });
    const { signals } = await readHealth();
    const outcome = signals.find((s) => s.key === "outcome_ingest")!;
    expect(outcome.state).toBe("not_expected");
    expect(outcome.expectedWithin).toBeNull();
    // The old success still displays — dormant hides nothing.
    expect(outcome.lastSuccessAt).not.toBeNull();
  });
});

describe("grading signal — expectedness is pending work, and the count is disclosed", () => {
  beforeEach(() => {
    emptyDb();
  });

  it("reads late with the awaiting count when work is pending past the nightly bound", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { awaiting_games: 3, pending_units: 41 },
    ]);
    routePipelineRuns({
      grading: { attempt: run("succeeded", 27), success: run("succeeded", 27) },
    });
    const { signals } = await readHealth();
    const grading = signals.find((s) => s.key === "grading")!;
    expect(grading.state).toBe("late");
    expect(grading.expectedWithin).toBe("26h of the last success");
    expect(grading.awaitingGrades).toBe(3);
  });

  it("stays visible as failed on a regrade-only backlog with zero awaiting games", async () => {
    // A stat correction leaves every game graded (no absent rows) yet the job
    // still has work; a failed cycle over that work must not hide behind a
    // zero awaiting count.
    mockPrisma.$queryRaw.mockResolvedValue([
      { awaiting_games: 0, pending_units: 7 },
    ]);
    routePipelineRuns({
      grading: { attempt: run("failed", 2), success: run("succeeded", 20) },
    });
    const { signals } = await readHealth();
    const grading = signals.find((s) => s.key === "grading")!;
    expect(grading.state).toBe("failed");
    expect(grading.awaitingGrades).toBe(0);
  });

  it("goes dormant when everything is graded, regardless of success age", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { awaiting_games: 0, pending_units: 0 },
    ]);
    routePipelineRuns({
      grading: {
        attempt: run("succeeded", 200),
        success: run("succeeded", 200),
      },
    });
    const { signals } = await readHealth();
    const grading = signals.find((s) => s.key === "grading")!;
    expect(grading.state).toBe("not_expected");
    expect(grading.awaitingGrades).toBe(0);
  });

  it("carries the awaiting count on the grading signal and nowhere else", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { awaiting_games: 2, pending_units: 9 },
    ]);
    const { signals } = await readHealth();
    for (const signal of signals) {
      if (signal.key === "grading") {
        expect(signal.awaitingGrades).toBe(2);
      } else {
        expect(signal).not.toHaveProperty("awaitingGrades");
      }
    }
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
