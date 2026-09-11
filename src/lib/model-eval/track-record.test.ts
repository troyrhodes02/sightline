import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * The viewer track-record read (PME-7, D8/D18/D22).
 *
 * Prisma is mocked at the seam. The two aggregate queries are routed by a
 * distinctive SQL marker — the bucket query filters on `least(floor(` while the
 * stat-total query does not — so a controlled count set can be fed in without a
 * database. The strength math and the 30-obs display floor are asserted at their
 * boundaries; the viewer-safety invariants are proven structurally from source.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: jest.fn() },
}));

import { prisma } from "@/lib/prisma";
import { readContractTrackRecord } from "./track-record";
import { TRACK_RECORD_BUCKET_FLOOR } from "./config";

const mockPrisma = prisma as unknown as { $queryRaw: jest.Mock };

const SIMULATION_VERSION = "simulation-mc-0.1.0";

/**
 * Routes the two aggregate queries by SQL marker: the bucket query carries
 * `least(floor(`, the stat-total query does not. Both are template-tag calls
 * whose first arg is the cooked string array.
 */
function routeQueries(opts: {
  bucket: { observations: number; observed_rate: number | null };
  statObservations: number;
}) {
  mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("least(floor(")) {
      return Promise.resolve([opts.bucket]);
    }
    return Promise.resolve([{ observations: opts.statObservations }]);
  });
}

const RESOLVED = {
  statType: "receiving_yards" as const,
  modelVersion: SIMULATION_VERSION,
  modelProbability: 0.74,
  confidence: "high" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Derives from the ACTIVE model's graded record
// ---------------------------------------------------------------------------

describe("derives from the active model's graded record", () => {
  it("filters both aggregates by the contract's active model version and stat", async () => {
    routeQueries({
      bucket: { observations: 184, observed_rate: 0.72 },
      statObservations: 2500,
    });

    await readContractTrackRecord(RESOLVED, "viewer");

    // Every query is parameterised with the active model version and stat — the
    // block reads the active production model's own record and nothing else.
    for (const call of mockPrisma.$queryRaw.mock.calls) {
      expect(call).toContain(SIMULATION_VERSION);
      expect(call).toContain("receiving_yards");
    }
  });

  it("maps the displayed probability to its fixed-tenth bucket label", async () => {
    routeQueries({
      bucket: { observations: 184, observed_rate: 0.72 },
      statObservations: 2500,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    // 0.74 → floor(7.4) = bin 7 → 70–80%.
    expect(dto?.rangeLabel).toBe("70–80%");
  });

  it("returns the observed rate and both counts above the floor", async () => {
    routeQueries({
      bucket: { observations: 184, observed_rate: 0.72 },
      statObservations: 2500,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    expect(dto?.rangeObservedRate).toBeCloseTo(0.72, 10);
    expect(dto?.rangeSampleSize).toBe(184);
    expect(dto?.statObservations).toBe(2500);
    expect(dto?.belowFloor).toBe(false);
  });

  it("returns the identical payload for admin and viewer (D18)", async () => {
    routeQueries({
      bucket: { observations: 184, observed_rate: 0.72 },
      statObservations: 2500,
    });

    const asViewer = await readContractTrackRecord(RESOLVED, "viewer");
    const asAdmin = await readContractTrackRecord(RESOLVED, "admin");
    expect(asAdmin).toEqual(asViewer);
  });
});

// ---------------------------------------------------------------------------
// D8 — the 30-observation bucket-display floor
// ---------------------------------------------------------------------------

describe("30-observation bucket-display floor (D8)", () => {
  it("withholds the rate below 30 observations, keeping the running count", async () => {
    routeQueries({
      bucket: { observations: 18, observed_rate: 0.61 },
      statObservations: 900,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    // Never a fabricated rate below the floor — null, distinct from a real 0.
    expect(dto?.rangeObservedRate).toBeNull();
    // The honest running count is still reported.
    expect(dto?.rangeSampleSize).toBe(18);
    expect(dto?.belowFloor).toBe(true);
  });

  it("reports the rate at exactly the floor (inclusive)", async () => {
    routeQueries({
      bucket: {
        observations: TRACK_RECORD_BUCKET_FLOOR,
        observed_rate: 0.5,
      },
      statObservations: 900,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    expect(dto?.belowFloor).toBe(false);
    expect(dto?.rangeObservedRate).toBeCloseTo(0.5, 10);
  });

  it("uses 30 — the shared circuit-breaker minimum", () => {
    expect(TRACK_RECORD_BUCKET_FLOOR).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Insufficient / building — described honestly, never fabricated
// ---------------------------------------------------------------------------

describe("insufficient sample is described honestly", () => {
  it("returns null (building) when the stat has no graded evidence yet", async () => {
    routeQueries({
      bucket: { observations: 0, observed_rate: null },
      statObservations: 0,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    expect(dto).toBeNull();
  });

  it("returns null when there is no active-model projection to interpret", async () => {
    const dto = await readContractTrackRecord(
      { ...RESOLVED, modelVersion: null, modelProbability: null },
      "viewer",
    );
    expect(dto).toBeNull();
    // No query runs — nothing to read without an active projection.
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("may report a limited track record even when the bucket is below floor", async () => {
    // A thin bucket (below display floor) but a real, if small, pooled stat
    // sample — the label is a qualitative strength, not the bucket's rate.
    routeQueries({
      bucket: { observations: 12, observed_rate: 0.5 },
      statObservations: 120,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    expect(dto?.belowFloor).toBe(true);
    expect(dto?.trackRecord).toBe("limited");
  });
});

// ---------------------------------------------------------------------------
// D22 / D18 — viewer-safety, proven structurally
// ---------------------------------------------------------------------------

describe("viewer-safety: no second engine, no admin data (D18/D22)", () => {
  it("the payload exposes ONLY the viewer-safe fields", async () => {
    routeQueries({
      bucket: { observations: 184, observed_rate: 0.72 },
      statObservations: 2500,
    });

    const dto = await readContractTrackRecord(RESOLVED, "viewer");
    expect(dto).not.toBeNull();
    // The DTO is the whole payload — anything not here cannot leak.
    expect(Object.keys(dto as object).sort()).toEqual(
      [
        "belowFloor",
        "confidence",
        "modelProbability",
        "rangeLabel",
        "rangeObservedRate",
        "rangeSampleSize",
        "statObservations",
        "statType",
        "trackRecord",
      ].sort(),
    );
  });

  it("names no leader, shadow, bankroll, or admin surface in its source", () => {
    // Strip import lines: a shared helper's path (`./leader`) is not the read
    // naming a leader comparison. The concern is the read's own logic.
    const source = readCode(join(__dirname, "track-record.ts"))
      .split("\n")
      .filter((line) => !/^\s*import\b/.test(line))
      .join("\n")
      .toLowerCase();
    // No leader comparison, no second engine, no paper ledger, no admin link —
    // a viewer cannot infer a second engine runs (D22).
    expect(source).not.toContain("leaderstate");
    expect(source).not.toContain("determineleader");
    expect(source).not.toContain("comparison");
    expect(source).not.toContain("shadow");
    expect(source).not.toContain("bankroll");
    expect(source).not.toContain("scorecard");
    // It reads no price, decision, or settlement — the block is a function of
    // graded model outcomes alone.
    expect(source).not.toContain("priceobservation");
    expect(source).not.toContain("recommendationsnapshot");
    expect(source).not.toContain("prisma.decision");
  });

  it("never queries a second model version — only the one passed in", async () => {
    routeQueries({
      bucket: { observations: 184, observed_rate: 0.72 },
      statObservations: 2500,
    });

    await readContractTrackRecord(RESOLVED, "viewer");

    const baseline = "baseline-zil-0.1.0";
    for (const call of mockPrisma.$queryRaw.mock.calls) {
      expect(call).not.toContain(baseline);
    }
  });
});
