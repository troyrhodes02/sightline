import { readProjectionAccuracy } from "./projection-accuracy";
import { prisma } from "@/lib/prisma";
import { BASELINE_VERSION, SIMULATION_VERSION } from "./config";

jest.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: jest.fn() },
}));

const mockPrisma = prisma as unknown as { $queryRaw: jest.Mock };

type Grouped = {
  model_version: string;
  stat_type: string;
  mae: number | null;
  rmse: number | null;
  n: number;
};

function row(
  over: Partial<Grouped> & { model_version: string; stat_type: string },
): Grouped {
  return { mae: 10, rmse: 12, n: 100, ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe("readProjectionAccuracy", () => {
  it("returns a row per supported stat and pivots each engine's MAE/RMSE/count", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      row({
        model_version: BASELINE_VERSION,
        stat_type: "receiving_yards",
        mae: 12.4,
        rmse: 16.0,
        n: 210,
      }),
      row({
        model_version: SIMULATION_VERSION,
        stat_type: "receiving_yards",
        mae: 11.8,
        rmse: 15.2,
        n: 95,
      }),
    ]);

    const rows = await readProjectionAccuracy();
    expect(rows.map((r) => r.statType)).toEqual([
      "passing_yards",
      "rushing_yards",
      "receiving_yards",
      "receptions",
      "rushing_tds",
      "receiving_tds",
    ]);
    const rec = rows.find((r) => r.statType === "receiving_yards")!;
    expect(rec.baseline).toEqual({ mae: 12.4, rmse: 16.0, count: 210 });
    expect(rec.simulation).toEqual({ mae: 11.8, rmse: 15.2, count: 95 });
    // Both clear the 30 floor; Simulation's MAE is lower by 0.6 (> 0.1) → closer.
    expect(rec.closer).toBe("simulation");
  });

  it("marks an engine with no grades as null, and closer null when one side is missing", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      row({
        model_version: BASELINE_VERSION,
        stat_type: "rushing_yards",
        mae: 9,
        rmse: 11,
        n: 148,
      }),
      // no simulation row for rushing_yards
    ]);
    const rows = await readProjectionAccuracy();
    const rush = rows.find((r) => r.statType === "rushing_yards")!;
    expect(rush.baseline).not.toBeNull();
    expect(rush.simulation).toBeNull();
    expect(rush.closer).toBeNull();
  });

  it("withholds a leader below the 30-observation floor even with both engines present", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      row({
        model_version: BASELINE_VERSION,
        stat_type: "passing_yards",
        mae: 40,
        rmse: 55,
        n: 20,
      }),
      row({
        model_version: SIMULATION_VERSION,
        stat_type: "passing_yards",
        mae: 30,
        rmse: 42,
        n: 12,
      }),
    ]);
    const rows = await readProjectionAccuracy();
    const pass = rows.find((r) => r.statType === "passing_yards")!;
    // Numbers still present...
    expect(pass.baseline).not.toBeNull();
    expect(pass.simulation).not.toBeNull();
    // ...but no winner named (both below 30).
    expect(pass.closer).toBeNull();
  });

  it("reports 'even' when both clear the floor and MAEs are within a negligible margin", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      row({
        model_version: BASELINE_VERSION,
        stat_type: "receptions",
        mae: 1.24,
        rmse: 1.8,
        n: 260,
      }),
      row({
        model_version: SIMULATION_VERSION,
        stat_type: "receptions",
        mae: 1.29,
        rmse: 1.9,
        n: 114,
      }),
    ]);
    const rows = await readProjectionAccuracy();
    const rec = rows.find((r) => r.statType === "receptions")!;
    expect(rec.closer).toBe("even");
  });

  it("treats a null aggregate (no rows) as an engine with no data", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const rows = await readProjectionAccuracy();
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.baseline).toBeNull();
      expect(r.simulation).toBeNull();
      expect(r.closer).toBeNull();
    }
  });
});
