import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import type { StatType } from "../../../generated/prisma/enums";
import type { ModelSeriesDto } from "@/lib/dto/model-eval";

/**
 * The comparison assembly — overall pooling vs per-stat independence (D1),
 * live/backtest separation (D15), and the structural no-config-write invariant
 * (D12). `readModelSeries` is mocked so the two independently-read series can be
 * controlled per (version, record, population, statType) tuple.
 */

jest.mock("./read", () => ({
  readModelSeries: jest.fn(),
}));

import { readModelSeries } from "./read";
import {
  readComparison,
  readStatLeaders,
  readRecommendation,
} from "./comparison";
import { SIMULATION_VERSION } from "./config";

const mockRead = readModelSeries as jest.Mock;

function series(
  modelVersion: string,
  record: "live" | "backtest",
  brier: number | null,
  observations: number,
): ModelSeriesDto {
  return {
    modelVersion,
    record,
    population: "contract_like",
    brier,
    observations,
    recalibrationVersion: null,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("overall pooling vs per-stat are independent (D1)", () => {
  it("overall pools across stats (statType null) and can lead while a thin stat cannot", async () => {
    // Overall: simulation clearly ahead on a large pooled sample.
    mockRead.mockImplementation(
      async (
        version: string,
        record: "live" | "backtest",
        _population: string,
        statType: StatType | null,
      ) => {
        if (statType === null) {
          // Pooled contract-like — big sample, simulation leads.
          return version === SIMULATION_VERSION
            ? series(version, record, 0.19, 400)
            : series(version, record, 0.23, 400);
        }
        // A single thin stat with too little evidence.
        if (statType === "receiving_tds") {
          return series(
            version,
            record,
            version === SIMULATION_VERSION ? 0.1 : 0.3,
            10,
          );
        }
        // Other stats: sufficient, too close.
        return series(version, record, 0.2, 120);
      },
    );

    const overall = await readComparison("live", "contract_like", null);
    expect(overall.leader).toBe("simulation_leads");
    expect(overall.liveObservations).toBe(400);

    const stats = await readStatLeaders("live");
    const thin = stats.find((s) => s.statType === "receiving_tds");
    expect(thin?.leader).toBe("not_enough_evidence"); // 10 < 50 floor
    expect(thin?.belowFloor).toBe(true);

    const closeOne = stats.find((s) => s.statType === "passing_yards");
    expect(closeOne?.leader).toBe("too_close_to_call"); // margin 0
    expect(closeOne?.belowFloor).toBe(false);

    // Independence: the pooled leader is simulation, but no individual stat
    // inherits that — each is judged on its own population.
    expect(stats.every((s) => s.leader !== "simulation_leads")).toBe(true);
  });
});

describe("live and backtest are never blended (D15)", () => {
  it("a live comparison reports only live observations, backtest only backtest", async () => {
    mockRead.mockImplementation(
      async (version: string, record: "live" | "backtest") =>
        series(version, record, 0.2, record === "live" ? 100 : 800),
    );

    const live = await readComparison("live", "contract_like");
    expect(live.liveObservations).toBe(100);
    expect(live.backtestObservations).toBe(0);

    const backtest = await readComparison("backtest", "contract_like");
    expect(backtest.backtestObservations).toBe(800);
    expect(backtest.liveObservations).toBe(0);
  });
});

describe("recommendation is decision support only (D12)", () => {
  it("reads evidence and returns a DTO — no config mutation reachable", async () => {
    mockRead.mockImplementation(
      async (version: string, record: "live" | "backtest") =>
        series(
          version,
          record,
          version === SIMULATION_VERSION ? 0.18 : 0.23,
          300,
        ),
    );
    const rec = await readRecommendation("live");
    expect(rec.leader).toBe("simulation_leads");
    expect(rec.recommendedModelVersion).toBe(SIMULATION_VERSION);
    // The DTO itself has no callable that could apply a selection.
    for (const value of Object.values(rec)) {
      expect(typeof value).not.toBe("function");
    }
  });

  it("no module in model-eval writes ModelSelection, a risk config, or a campaign", () => {
    // Structural: the evidence layer is read-only w.r.t. production config. The
    // only writer of these is the confirmed selection route (SIG-105), never a
    // recommendation/leader/readiness path. Asserted from source so a future
    // write introduced here fails.
    const dir = __dirname;
    const forbidden = [
      /(prisma|tx)\.modelSelection\.(create|update|upsert|delete|createMany|updateMany)/,
      /(prisma|tx)\.paperRiskConfig\.(create|update|upsert)/,
      /(prisma|tx)\.paperCampaign\.(create|update|upsert)/,
      /(prisma|tx)\.paperEvaluationCampaign\.(create|update|upsert)/,
      /\.\$transaction/,
    ];
    const files = readdirSync(dir).filter(
      (f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readCode(join(dir, file));
      for (const pattern of forbidden) {
        expect({ file, matched: pattern.test(code) }).toEqual({
          file,
          matched: false,
        });
      }
    }
  });
});
