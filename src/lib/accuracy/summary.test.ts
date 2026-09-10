import { summarizeAccuracy } from "./summary";
import type {
  CalibrationBucketDto,
  CalibrationSeriesDto,
  ErrorPanelDto,
  MarketComparisonDto,
} from "@/lib/dto/accuracy";
import { REPORTING_FLOOR } from "./config";

function bucket(
  binIndex: number,
  predicted: number,
  observed: number,
  obs = 1500,
): CalibrationBucketDto {
  return {
    binIndex,
    binLow: binIndex / 10,
    binHigh: (binIndex + 1) / 10,
    predictedMean: predicted,
    observedRate: observed,
    thresholdObservations: obs,
    projectionCount: 300,
    belowFloor: obs < REPORTING_FLOOR,
  };
}

function series(
  overrides: Partial<CalibrationSeriesDto> = {},
): CalibrationSeriesDto {
  return {
    kind: "live",
    modelVersion: "simulation-mc-0.1.0",
    label: "Live",
    brier: 0.19,
    thresholdObservations: 1847,
    projectionCount: 412,
    buckets: [bucket(4, 0.45, 0.46), bucket(5, 0.55, 0.54)],
    eraDisclosure: null,
    ...overrides,
  };
}

const errorPanel: ErrorPanelDto = {
  projectionCount: 412,
  model: { mae: 18.4, rmse: 24.1 },
  seasonAverage: { mae: 21.2, rmse: 27.9 },
  trailingFive: { mae: 20.6, rmse: 27.0 },
  medianMae: 17.9,
};

const readyMarket: MarketComparisonDto = {
  state: "ready",
  thresholdObservations: 214,
  projectionCount: 118,
  modelBrier: 0.213,
  marketBrier: 0.221,
  meanEdgePoints: 1.8,
  ci95Low: -0.4,
  ci95High: 4.0,
  midpointEdgePoints: 2.6,
};

describe("summarizeAccuracy", () => {
  it("calls a well-populated, tight-gap record calibrated and carries both denominators", () => {
    const s = summarizeAccuracy({
      calibration: [series()],
      errorPanel,
      market: readyMarket,
    });
    expect(s.verdict).toBe("calibrated");
    expect(s.thresholdObservations).toBe(1847);
    expect(s.projectionCount).toBe(412);
    expect(s.brier).toBe(0.19);
    expect(s.brierGloss).toMatch(/lower is better/);
    expect(s.baselineVerdict).toMatch(/Better than both baselines/);
    expect(s.marketVerdict).toMatch(/Better calibrated than the market/);
  });

  it("does not claim 'below the floor' when the floor IS met but no Brier is available yet", () => {
    // Regression: with observations >= REPORTING_FLOOR but brier null, the old
    // message said "N observations, below the FLOOR needed" — a self-contradiction
    // (N already exceeds the floor). It must state the real reason instead.
    const s = summarizeAccuracy({
      calibration: [
        series({ thresholdObservations: REPORTING_FLOOR + 2000, brier: null }),
      ],
      errorPanel,
      market: { state: "insufficient", graded: 11, required: 30 },
    });
    expect(s.verdict).toBe("provisional");
    expect(s.calibrationVerdict).not.toMatch(/below the/i);
    expect(s.calibrationVerdict).toMatch(/reliability bucket/i);
  });

  it("reads a thin sample as not-enough-evidence, never as a bad score", () => {
    const s = summarizeAccuracy({
      calibration: [series({ thresholdObservations: 120, brier: 0.4 })],
      errorPanel,
      market: { state: "insufficient", graded: 11, required: 30 },
    });
    expect(s.verdict).toBe("provisional");
    expect(s.calibrationVerdict).toMatch(/Not enough evidence yet/);
    expect(s.marketVerdict).toMatch(/Insufficient comparable observations/);
    // Framed as not-enough-evidence, explicitly not a judgement of performance.
    expect(s.marketVerdict).toMatch(/not enough evidence yet/i);
    expect(s.marketVerdict).not.toMatch(/behind the market|poor calibration/i);
  });

  it("calls a well-sampled but diverging record drifting", () => {
    const s = summarizeAccuracy({
      calibration: [
        series({ buckets: [bucket(4, 0.45, 0.7), bucket(5, 0.55, 0.8)] }),
      ],
      errorPanel,
      market: readyMarket,
    });
    expect(s.verdict).toBe("drifting");
    expect(s.calibrationVerdict).toMatch(/diverge/);
  });

  it("handles an empty scope without fabricating a verdict", () => {
    const s = summarizeAccuracy({
      calibration: [],
      errorPanel: null,
      market: { state: "insufficient", graded: 0, required: 30 },
    });
    expect(s.verdict).toBe("provisional");
    expect(s.brier).toBeNull();
    expect(s.thresholdObservations).toBe(0);
    expect(s.calibrationVerdict).toMatch(/Not enough graded predictions/);
    expect(s.baselineVerdict).toMatch(/No graded projections/);
  });

  it("reports trend as insufficient rather than guessing from one aggregate", () => {
    const s = summarizeAccuracy({
      calibration: [series()],
      errorPanel,
      market: readyMarket,
    });
    expect(s.trend).toBe("insufficient");
  });
});
