import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * The comparison read — structural fairness (D4), live dedup (D3), backtest.
 *
 * Prisma and the fit store are mocked at the seam. The live dedup query is
 * routed by a distinctive SQL marker so a controlled row set can be fed in
 * without a database; the pure leader math has its own suite in
 * `leader.test.ts`.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    backtestRun: { findFirst: jest.fn() },
    calibrationBin: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/paper/recalibration/store", () => ({
  activeRecalibration: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { activeRecalibration } from "@/lib/paper/recalibration/store";
import { readModelSeries } from "./read";
import { SIMULATION_VERSION, BASELINE_VERSION } from "./config";

const mockPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
  backtestRun: { findFirst: jest.Mock };
  calibrationBin: { findMany: jest.Mock };
};
const mockActiveRecalibration = activeRecalibration as jest.Mock;

/** Identity knots — a fit that changes nothing, so raw Brier is testable. */
const IDENTITY_KNOTS = [
  [0, 0],
  [1, 1],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.backtestRun.findFirst.mockResolvedValue(null);
  mockPrisma.calibrationBin.findMany.mockResolvedValue([]);
  mockActiveRecalibration.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// D4 — recalibration fairness is STRUCTURALLY impossible to cross
// ---------------------------------------------------------------------------

describe("recalibration fairness is structurally impossible to cross (D4)", () => {
  it("resolves each model's own fit from the version — no fit parameter exists", async () => {
    mockActiveRecalibration.mockImplementation(async (version: string) => ({
      id: `fit-${version}`,
      version: version === SIMULATION_VERSION ? 7 : 3,
      modelVersion: version,
      knots: IDENTITY_KNOTS,
    }));
    mockPrisma.$queryRaw.mockResolvedValue([
      { stated_probability: 0.6, outcome: true },
    ]);

    const sim = await readModelSeries(
      SIMULATION_VERSION,
      "live",
      "contract_like",
    );
    const base = await readModelSeries(
      BASELINE_VERSION,
      "live",
      "contract_like",
    );

    // Each series carries ITS OWN fit version — proof the fit was resolved from
    // the version passed, not shared or crossed.
    expect(mockActiveRecalibration).toHaveBeenCalledWith(SIMULATION_VERSION);
    expect(mockActiveRecalibration).toHaveBeenCalledWith(BASELINE_VERSION);
    expect(sim.recalibrationVersion).toBe(7);
    expect(base.recalibrationVersion).toBe(3);
  });

  it("has no public API shape that accepts a foreign fit or a crossing parameter", () => {
    // The public read takes (modelVersion, record, population, statType?). It
    // does NOT take a fit, a knots array, an options object carrying a
    // correction, or a second model version — the crossing D4 forbids cannot
    // be expressed. Proven from the source signature so a future overload that
    // reintroduced a fit parameter fails this test.
    const source = readCode(join(__dirname, "read.ts"));
    const signature = source
      .slice(source.indexOf("export async function readModelSeries"))
      .split(")")[0];

    expect(signature).toContain("modelVersion: string");
    expect(signature).toContain("record: EvidenceRecord");
    expect(signature).toContain("population: ComparisonPopulation");
    // No parameter names a fit, knots, correction, or a second version.
    expect(signature).not.toMatch(/fit\s*:/);
    expect(signature).not.toMatch(/knots\s*:/);
    expect(signature).not.toMatch(/recalibration\s*:/i);
    expect(signature).not.toMatch(/correction\s*:/i);
    // The fit is resolved internally, from the version, with no override path.
    expect(source).toContain("activeRecalibration(modelVersion)");
  });

  it("applies the model's own fit, never a passed-in one, to its own Brier", async () => {
    // A non-identity fit that maps 0.6 → 0.9. Brier under the fit must use 0.9,
    // proving the correction is the model's own resolved knots.
    mockActiveRecalibration.mockResolvedValue({
      id: "fit-sim",
      version: 2,
      modelVersion: SIMULATION_VERSION,
      knots: [
        [0, 0],
        [0.6, 0.9],
        [1, 1],
      ],
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { stated_probability: 0.6, outcome: true },
    ]);

    const series = await readModelSeries(
      SIMULATION_VERSION,
      "live",
      "contract_like",
    );
    // (0.9 − 1)^2 = 0.01, not (0.6 − 1)^2 = 0.16.
    expect(series.brier).toBeCloseTo(0.01, 10);
  });
});

// ---------------------------------------------------------------------------
// D3 — live-evidence dedup
// ---------------------------------------------------------------------------

describe("live-evidence dedup (D3)", () => {
  it("counts exactly one observation per (model, contract) via DISTINCT ON latest pre-kickoff", async () => {
    // The read delegates dedup to SQL: DISTINCT ON (model_version, contract_id)
    // ordered by computed_at DESC, gated on computed_at < kickoff_at. The mock
    // returns the single row that survives dedup — the test asserts the query
    // carries the dedup + freeze predicates so the DB does the deduplication.
    let capturedSql = "";
    mockPrisma.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray) => {
        capturedSql = strings.raw.join(" ? ");
        return [{ stated_probability: 0.7, outcome: true }];
      },
    );

    const series = await readModelSeries(
      SIMULATION_VERSION,
      "live",
      "contract_like",
    );

    expect(capturedSql).toContain(
      "DISTINCT ON (p2.model_version, tg2.contract_id)",
    );
    expect(capturedSql).toContain("p2.computed_at < g2.kickoff_at");
    expect(capturedSql).toContain("ORDER BY p2.model_version, tg2.contract_id");
    expect(capturedSql).toContain("p2.computed_at DESC");
    // One surviving observation → counted once.
    expect(series.observations).toBe(1);
  });

  it("an empty deduped set is a null Brier, distinct from zero", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const series = await readModelSeries(
      SIMULATION_VERSION,
      "live",
      "contract_like",
    );
    expect(series.brier).toBeNull();
    expect(series.observations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Backtest — model's own bins, corrected under the model's own fit
// ---------------------------------------------------------------------------

describe("backtest record reads the model's own bins (D4/D15)", () => {
  it("computes a sample-weighted Brier over the model's stored bins", async () => {
    mockPrisma.backtestRun.findFirst.mockResolvedValue({ id: "run-1" });
    mockPrisma.calibrationBin.findMany.mockResolvedValue([
      { predictedMean: 0.5, observedRate: 0.5, thresholdObservations: 800 },
      { predictedMean: 0.9, observedRate: 0.8, thresholdObservations: 200 },
    ]);
    mockActiveRecalibration.mockResolvedValue(null); // identity

    const series = await readModelSeries(
      BASELINE_VERSION,
      "backtest",
      "contract_like",
    );
    // (800*(0.5-0.5)^2 + 200*(0.9-0.8)^2) / 1000 = 0.002
    expect(series.brier).toBeCloseTo(0.002, 10);
    expect(series.observations).toBe(1000);
  });

  it("market_linked backtest is honestly empty (no stored segment)", async () => {
    const series = await readModelSeries(
      BASELINE_VERSION,
      "backtest",
      "market_linked",
    );
    expect(series.brier).toBeNull();
    expect(series.observations).toBe(0);
    expect(mockPrisma.backtestRun.findFirst).not.toHaveBeenCalled();
  });
});
