import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * Prisma is mocked at the seam. Raw aggregation queries are routed by
 * distinctive SQL markers so each read can be fed controlled rows without a
 * database; the pure derivations have their own suite in `compute.test.ts`.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    pipelineRun: { findFirst: jest.fn() },
    backtestRun: { findFirst: jest.fn() },
    calibrationBin: { findMany: jest.fn() },
    recommendationSnapshot: { findMany: jest.fn() },
    outcome: { count: jest.fn() },
    decision: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { readAccuracy } from "./read";
import { parseAccuracyScope } from "./scope";

const mockPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
  pipelineRun: { findFirst: jest.Mock };
  backtestRun: { findFirst: jest.Mock };
  calibrationBin: { findMany: jest.Mock };
  recommendationSnapshot: { findMany: jest.Mock };
  outcome: { count: jest.Mock };
  decision: { findMany: jest.Mock };
};

type RawRoutes = {
  versions?: Array<{ model_version: string }>;
  seasons?: Array<{ season: number }>;
  buckets?: Array<{
    bin_index: number;
    threshold_observations: number;
    projection_count: number;
    predicted_mean: number | null;
    observed_rate: number | null;
  }>;
  headline?: Array<{
    observations: number;
    projections: number;
    brier: number | null;
  }>;
  errorPanel?: Array<Record<string, number | null>>;
  gradedThrough?: Array<{ season: number; week: number }>;
  awaiting?: Array<{ games: number }>;
  exclusionStatuses?: Array<{ reason: string; count: number }>;
};

function routeRawQueries(routes: RawRoutes) {
  mockPrisma.$queryRaw.mockImplementation(
    async (strings: TemplateStringsArray) => {
      const sql = strings.raw.join(" ? ");
      if (sql.includes("GROUP BY p.model_version"))
        return routes.versions ?? [];
      if (sql.includes("SELECT DISTINCT g.season")) return routes.seasons ?? [];
      if (sql.includes("AS bin_index")) return routes.buckets ?? [];
      if (sql.includes("AS brier")) return routes.headline ?? [];
      if (sql.includes("abs_error_mean")) {
        return routes.errorPanel ?? [emptyErrorRow()];
      }
      if (sql.includes("ORDER BY g.season DESC, g.week DESC")) {
        return routes.gradedThrough ?? [];
      }
      if (sql.includes("AS games")) return routes.awaiting ?? [{ games: 0 }];
      if (sql.includes("<> 'graded'")) return routes.exclusionStatuses ?? [];
      throw new Error(`unrouted raw query: ${sql.slice(0, 120)}`);
    },
  );
}

function emptyErrorRow() {
  return {
    projection_count: 0,
    model_mae: null,
    model_rmse: null,
    season_mae: null,
    season_rmse: null,
    trailing_mae: null,
    trailing_rmse: null,
    median_mae: null,
  };
}

function emptyDb(routes: RawRoutes = {}) {
  routeRawQueries(routes);
  mockPrisma.pipelineRun.findFirst.mockResolvedValue(null);
  mockPrisma.backtestRun.findFirst.mockResolvedValue(null);
  mockPrisma.calibrationBin.findMany.mockResolvedValue([]);
  mockPrisma.recommendationSnapshot.findMany.mockResolvedValue([]);
  mockPrisma.outcome.count.mockResolvedValue(0);
  mockPrisma.decision.findMany.mockResolvedValue([]);
}

const COMPLETED_RUN = {
  id: "run-1",
  label: "harness-2026",
  modelVersion: "baseline-v1",
  seasonFrom: 2019,
  seasonTo: 2024,
  aggregates: {
    overall: {
      thresholds: { brier: 0.126, observations: 223671, projections: 28852 },
    },
    contractLike: {
      thresholds: { brier: 0.131, observations: 41210, projections: 9120 },
    },
    byEra: {
      archived_forecast: { comparison: { model: { mae: 22.1 } } },
      reanalysis: { comparison: { model: { mae: 21.4 } } },
    },
  },
};

const LIVE_BUCKET = {
  bin_index: 3,
  threshold_observations: 1200,
  projection_count: 300,
  predicted_mean: 0.35,
  observed_rate: 0.34,
};

function scope(params: Record<string, string> = {}) {
  return parseAccuracyScope(params);
}

describe("readAccuracy — role serializers", () => {
  beforeEach(() => emptyDb());

  it("builds a viewer payload with no overridesEntry key — absent, not null", async () => {
    const dto = await readAccuracy(scope(), "viewer");
    expect("overridesEntry" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toMatch(/decision/i);
  });

  it("never queries decisions on the viewer path", async () => {
    await readAccuracy(scope(), "viewer");
    expect(mockPrisma.decision.findMany).not.toHaveBeenCalled();
  });

  it("attaches the overrides entry for the admin", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([
      { contractId: "c1" },
      { contractId: "c2" },
    ]);
    const dto = await readAccuracy(scope(), "admin");
    expect(dto.overridesEntry).toEqual({ decisionCount: 2 });
  });
});

describe("readAccuracy — scope resolution", () => {
  beforeEach(() =>
    emptyDb({
      versions: [{ model_version: "v2" }, { model_version: "v1" }],
      seasons: [{ season: 2026 }, { season: 2025 }],
    }),
  );

  it("defaults the version to the latest deployed with graded data", async () => {
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.scope.modelVersion).toBe("v2");
    expect(dto.availableVersions).toEqual(["v2", "v1"]);
  });

  it("keeps a recognized version and season", async () => {
    const dto = await readAccuracy(
      scope({ version: "v1", season: "2025" }),
      "viewer",
    );
    expect(dto.scope.modelVersion).toBe("v1");
    expect(dto.scope.season).toBe(2025);
  });

  it("falls back to defaults on an unrecognized version and an ungraded season", async () => {
    const dto = await readAccuracy(
      scope({ version: "v99", season: "2031" }),
      "viewer",
    );
    expect(dto.scope.modelVersion).toBe("v2");
    expect(dto.scope.season).toBe("all");
  });

  it("keeps the labelled combined view when version=all", async () => {
    const dto = await readAccuracy(scope({ version: "all" }), "viewer");
    expect(dto.scope.modelVersion).toBe("all");
  });
});

describe("readAccuracy — calibration records", () => {
  it("returns a live series with ten fixed buckets and both denominators in the label", async () => {
    emptyDb({
      buckets: [LIVE_BUCKET],
      headline: [{ observations: 1847, projections: 412, brier: 0.213 }],
    });
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.calibration).toHaveLength(1);
    const live = dto.calibration[0];
    expect(live.kind).toBe("live");
    expect(live.buckets).toHaveLength(10);
    expect(live.buckets.map((b) => b.binIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(live.brier).toBe(0.213);
    expect(live.thresholdObservations).toBe(1847);
    expect(live.projectionCount).toBe(412);
    expect(live.label).toContain("1,847 obs");
    expect(live.label).toContain("412 projections");
  });

  it("compare returns two labelled series and never merges them", async () => {
    emptyDb({
      buckets: [LIVE_BUCKET],
      headline: [{ observations: 214, projections: 118, brier: 0.241 }],
    });
    mockPrisma.backtestRun.findFirst.mockResolvedValue(COMPLETED_RUN);
    mockPrisma.calibrationBin.findMany.mockResolvedValue([
      {
        binIndex: 3,
        predictedMean: 0.351,
        observedRate: 0.339,
        thresholdObservations: 20000,
        projectionCount: 4100,
        belowFloor: false,
      },
    ]);
    const dto = await readAccuracy(scope({ record: "compare" }), "viewer");
    expect(dto.calibration.map((s) => s.kind)).toEqual(["live", "backtest"]);
    const [live, backtest] = dto.calibration;
    expect(live.buckets).not.toBe(backtest.buckets);
    expect(live.label).not.toBe(backtest.label);
    // Each series carries its own Brier and denominators — nothing pooled.
    expect(live.brier).toBe(0.241);
    expect(backtest.brier).toBe(0.131); // contract_like default population
    expect(backtest.thresholdObservations).toBe(41210);
    expect(backtest.projectionCount).toBe(9120);
  });

  it("names the backtest run in its label and carries the era disclosure", async () => {
    emptyDb();
    mockPrisma.backtestRun.findFirst.mockResolvedValue(COMPLETED_RUN);
    const dto = await readAccuracy(scope({ record: "backtest" }), "viewer");
    expect(dto.calibration).toHaveLength(1);
    const backtest = dto.calibration[0];
    expect(backtest.label).toContain("harness-2026");
    expect(backtest.label).toContain("2019–2024");
    expect(backtest.eraDisclosure).toContain("Reanalysis era (pre-2021)");
    expect(backtest.eraDisclosure).toContain("21.4");
    expect(backtest.eraDisclosure).toContain("accepted look-ahead leak");
  });

  it("reads the pooled all-population segment when the population is all", async () => {
    emptyDb();
    mockPrisma.backtestRun.findFirst.mockResolvedValue(COMPLETED_RUN);
    const dto = await readAccuracy(
      scope({ record: "backtest", population: "all" }),
      "viewer",
    );
    expect(dto.calibration[0].brier).toBe(0.126);
    expect(mockPrisma.calibrationBin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ population: null }),
      }),
    );
  });

  it("omits the backtest series for scopes the harness did not pool", async () => {
    emptyDb();
    mockPrisma.backtestRun.findFirst.mockResolvedValue(COMPLETED_RUN);
    const unpooled: Array<Record<string, string>> = [
      { record: "backtest", stat: "receiving_yards" },
      { record: "backtest", population: "market_linked" },
    ];
    for (const params of unpooled) {
      const dto = await readAccuracy(scope(params), "viewer");
      expect(dto.calibration.filter((s) => s.kind === "backtest")).toEqual([]);
    }
  });

  it("renders an honest empty live series for a scope with no grades", async () => {
    emptyDb();
    const dto = await readAccuracy(scope(), "viewer");
    const live = dto.calibration[0];
    expect(live.thresholdObservations).toBe(0);
    expect(live.projectionCount).toBe(0);
    expect(live.brier).toBeNull();
    expect(live.buckets).toHaveLength(10);
    expect(live.buckets.every((b) => b.predictedMean === null)).toBe(true);
    expect(dto.errorPanel).toBeNull();
    expect(dto.market).toEqual({
      state: "insufficient",
      graded: 0,
      required: 30,
    });
  });
});

describe("readAccuracy — market panel", () => {
  const snapshot = (index: number) => ({
    side: "yes",
    modelProbability: 0.6,
    askCents: 55,
    projectionId: `p${index % 10}`,
    contract: { outcome: { result: "yes" } },
    priceObservation: {
      yesBidCents: 53,
      yesAskCents: 55,
      noBidCents: 45,
      noAskCents: 47,
    },
  });

  it("always carries the interval in the ready state", async () => {
    emptyDb();
    mockPrisma.recommendationSnapshot.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => snapshot(i)),
    );
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.market.state).toBe("ready");
    if (dto.market.state !== "ready") return;
    expect(Number.isFinite(dto.market.ci95Low)).toBe(true);
    expect(Number.isFinite(dto.market.ci95High)).toBe(true);
    expect(dto.market.thresholdObservations).toBe(30);
    expect(dto.market.projectionCount).toBe(10);
  });

  it("reports the running count below 30", async () => {
    emptyDb();
    mockPrisma.recommendationSnapshot.findMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => snapshot(i)),
    );
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.market).toEqual({
      state: "insufficient",
      graded: 11,
      required: 30,
    });
  });

  it("pins to market-linked snapshots regardless of the population selector", async () => {
    emptyDb();
    await readAccuracy(scope({ population: "all" }), "viewer");
    const call = mockPrisma.recommendationSnapshot.findMany.mock.calls[0][0];
    // The query is anchored to graded final snapshots with settled outcomes —
    // the market-linked unit — not to the population selector.
    expect(call.where.trigger).toBe("final_pre_kickoff");
    expect(call.where.contract.outcome.result).toEqual({
      in: ["yes", "no"],
    });
  });
});

describe("readAccuracy — freshness and exclusions", () => {
  it("discloses a delay only when work awaits AND the last success is stale", async () => {
    emptyDb({
      gradedThrough: [{ season: 2026, week: 15 }],
      awaiting: [{ games: 3 }],
    });
    mockPrisma.pipelineRun.findFirst.mockResolvedValue({
      finishedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.gradedThroughWeek).toEqual({ season: 2026, week: 15 });
    expect(dto.gradingDelayed).toBe(true);
  });

  it("treats a quiet backlog-free surface as not delayed even when nothing ever ran", async () => {
    emptyDb({ awaiting: [{ games: 0 }] });
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.gradingDelayed).toBe(false);
    expect(dto.lastGradingCycleAt).toBeNull();
  });

  it("exposes freshness as exactly the three shared fields — never signal states or the awaiting count", async () => {
    // SIG-55: the health surface derives grading/outcome-ingest signal states
    // and an awaiting-grades count, all admin-only. The shared accuracy
    // payload carries graded-through, the last cycle timestamp, and the
    // delayed flag — and structurally nothing of the health vocabulary.
    emptyDb({
      gradedThrough: [{ season: 2026, week: 15 }],
      awaiting: [{ games: 3 }],
    });
    const dto = await readAccuracy(scope(), "viewer");

    expect(Object.keys(dto).sort()).toEqual([
      "availableSeasons",
      "availableVersions",
      "calibration",
      "errorPanel",
      "exclusions",
      "gradedThroughWeek",
      "gradingDelayed",
      "lastGradingCycleAt",
      "market",
      "scope",
    ]);

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("awaiting");
    expect(serialized).not.toContain("signal");
    expect(serialized).not.toContain("not_expected");
    expect(serialized).not.toContain("never_run");
  });

  it("counts exclusions by taxonomy reason and drops zero counts", async () => {
    emptyDb({
      exclusionStatuses: [{ reason: "missing_official_result", count: 14 }],
    });
    mockPrisma.outcome.count
      .mockResolvedValueOnce(3) // unresolved_identity
      .mockResolvedValueOnce(6); // contract_voided
    const dto = await readAccuracy(scope(), "viewer");
    expect(dto.exclusions).toEqual([
      { reason: "missing_official_result", count: 14 },
      { reason: "unresolved_identity", count: 3 },
      { reason: "contract_voided", count: 6 },
    ]);
  });
});

describe("accuracy read structure", () => {
  const readSource = readCode(
    join(process.cwd(), "src", "lib", "accuracy", "read.ts"),
  );

  it("attaches decisions only on the admin branch", () => {
    // The viewer path must not merely omit decisions — it must never query
    // them. One code branch, gated on role, is the structural guarantee.
    const decisionQueries = readSource.match(/prisma\.decision\./g);
    expect(decisionQueries?.length).toBe(1);
    const adminGates = readSource.match(/if \(role === "admin"\)/g);
    expect(adminGates?.length).toBe(1);
    const gateIndex = readSource.indexOf('if (role === "admin")');
    const queryIndex = readSource.indexOf("prisma.decision.");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(gateIndex);
  });

  it("stores nothing — the accuracy read is derivation, never denormalisation", () => {
    expect(readSource).not.toMatch(/\.(create|update|upsert|delete)\(/);
    expect(readSource).not.toContain("$transaction");
    expect(readSource).not.toContain("$executeRaw");
  });
});
