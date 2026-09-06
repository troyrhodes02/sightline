/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type {
  AccuracyDto,
  CalibrationBucketDto,
  CalibrationSeriesDto,
} from "@/lib/dto/accuracy";
import { Accuracy } from "./Accuracy";
import { ReliabilityCurve } from "@/components/accuracy/ReliabilityCurve";
import { SampleSizePair } from "@/components/accuracy/SampleSizePair";

jest.mock("next/navigation", () => ({
  usePathname: () => "/accuracy",
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function bucket(
  binIndex: number,
  overrides: Partial<CalibrationBucketDto> = {},
): CalibrationBucketDto {
  return {
    binIndex,
    binLow: binIndex / 10,
    binHigh: (binIndex + 1) / 10,
    predictedMean: null,
    observedRate: null,
    thresholdObservations: 0,
    projectionCount: 0,
    belowFloor: true,
    ...overrides,
  };
}

const populatedBuckets: CalibrationBucketDto[] = Array.from(
  { length: 10 },
  (_, i) =>
    i >= 3 && i <= 6
      ? bucket(i, {
          predictedMean: i / 10 + 0.05,
          observedRate: i / 10 + 0.04,
          thresholdObservations: i === 6 ? 38 : 1200,
          projectionCount: i === 6 ? 14 : 300,
          belowFloor: i === 6,
        })
      : bucket(i),
);

const liveSeries: CalibrationSeriesDto = {
  kind: "live",
  label: "Live · 1,847 obs · 412 projections",
  brier: 0.213,
  thresholdObservations: 1847,
  projectionCount: 412,
  buckets: populatedBuckets,
  eraDisclosure: null,
};

const backtestSeries: CalibrationSeriesDto = {
  kind: "backtest",
  label: "Backtest harness-2026 2019–2024 · 223,671 obs · 28,852 projections",
  brier: 0.126,
  thresholdObservations: 223671,
  projectionCount: 28852,
  buckets: populatedBuckets,
  eraDisclosure:
    "Reanalysis era (pre-2021) reported separately: model MAE 21.4 — accepted look-ahead leak, see Backtesting Harness.",
};

function dto(overrides: Partial<AccuracyDto> = {}): AccuracyDto {
  return {
    scope: {
      record: "live",
      modelVersion: "v1",
      population: "contract_like",
      statType: "all",
      season: "all",
    },
    gradedThroughWeek: { season: 2026, week: 17 },
    lastGradingCycleAt: "2026-01-04T04:40:00.000Z",
    gradingDelayed: false,
    calibration: [liveSeries],
    errorPanel: {
      projectionCount: 412,
      model: { mae: 18.4, rmse: 24.1 },
      seasonAverage: { mae: 21.2, rmse: 27.9 },
      trailingFive: { mae: 20.6, rmse: 27.0 },
      medianMae: 17.9,
    },
    market: {
      state: "ready",
      thresholdObservations: 214,
      projectionCount: 118,
      modelBrier: 0.213,
      marketBrier: 0.221,
      meanEdgePoints: 1.8,
      ci95Low: -0.4,
      ci95High: 4.0,
      midpointEdgePoints: 2.6,
    },
    exclusions: [
      { reason: "missing_official_result", count: 14 },
      { reason: "contract_voided", count: 6 },
      { reason: "unresolved_identity", count: 3 },
    ],
    availableVersions: ["v1"],
    availableSeasons: [2026],
    ...overrides,
  };
}

describe("Accuracy screen — populated", () => {
  it("renders the headline Brier with both denominators beside it", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(container.textContent).toContain("Brier 0.213");
    expect(container.textContent).toContain("1,847 obs · 412 projections");
  });

  it("renders the bucket table with the below-floor annotation", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(screen.getByText("below floor")).toBeTruthy();
    // The table is the chart's text equivalent: all ten fixed rows exist.
    expect(container.textContent).toContain("0–10%");
    expect(container.textContent).toContain("90–100%");
  });

  it("keeps error and calibration in separate frames with the median disclosed, not raced", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(screen.getByText("Error vs baselines")).toBeTruthy();
    expect(screen.getByText("season average")).toBeTruthy();
    expect(screen.getByText("trailing five")).toBeTruthy();
    expect(container.textContent).toContain("median MAE 17.9");
    expect(container.textContent).toContain("baselines are mean-based");
  });

  it("renders the market panel pinned to market-linked with the interval beside the edge", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(container.textContent).toContain("market-linked population");
    expect(container.textContent).toContain("+1.8 pts");
    expect(container.textContent).toContain("−0.4 … +4.0");
    expect(container.textContent).toContain("midpoint edge (secondary)");
  });

  it("renders the freshness line without a delay disclosure when current", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(container.textContent).toContain("Graded through Wk 17 2026");
    expect(container.textContent).not.toContain("results may trail");
  });

  it("appends the delay disclosure when grading is late — a disclosure, not an error", () => {
    const { container } = renderThemed(
      <Accuracy accuracy={dto({ gradingDelayed: true })} />,
    );
    expect(container.textContent).toContain("results may trail recent games");
  });

  it("counts exclusions by reason on the exclusions line", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(container.textContent).toContain("23 unresolvable");
    expect(container.textContent).toContain("14 no official result");
    expect(container.textContent).toContain("6 voided");
    expect(container.textContent).toContain("3 unresolved player");
  });
});

describe("Accuracy screen — compare and records", () => {
  it("renders compare as two labelled series, never merged", () => {
    const { container } = renderThemed(
      <Accuracy
        accuracy={dto({
          scope: {
            record: "compare",
            modelVersion: "v1",
            population: "contract_like",
            statType: "all",
            season: "all",
          },
          calibration: [liveSeries, backtestSeries],
        })}
      />,
    );
    expect(container.textContent).toContain("Live · Brier 0.213");
    expect(container.textContent).toContain("Backtest · Brier 0.126");
    expect(container.textContent).toContain("223,671 obs");
  });

  it("carries the era-split disclosure whenever the backtest record renders", () => {
    const { container } = renderThemed(
      <Accuracy
        accuracy={dto({
          scope: {
            record: "backtest",
            modelVersion: "v1",
            population: "contract_like",
            statType: "all",
            season: "all",
          },
          calibration: [backtestSeries],
        })}
      />,
    );
    expect(container.textContent).toContain("Reanalysis era (pre-2021)");
    expect(container.textContent).toContain("accepted look-ahead leak");
  });

  it("says which scope the backtest record needs instead of silently switching", () => {
    const { container } = renderThemed(
      <Accuracy
        accuracy={dto({
          scope: {
            record: "backtest",
            modelVersion: "v1",
            population: "contract_like",
            statType: "receiving_yards",
            season: "all",
          },
          calibration: [],
        })}
      />,
    );
    expect(container.textContent).toContain(
      "The backtest record stores pooled populations only",
    );
  });
});

describe("Accuracy screen — designed states", () => {
  it("renders the designed empty state for a scope with no grades", () => {
    renderThemed(
      <Accuracy
        accuracy={dto({
          calibration: [
            { ...liveSeries, thresholdObservations: 0, buckets: [] },
          ],
          errorPanel: null,
          market: { state: "insufficient", graded: 0, required: 30 },
          exclusions: [],
        })}
      />,
    );
    expect(
      screen.getByText("No graded predictions for this scope."),
    ).toBeTruthy();
    expect(screen.getByText("View backtest record")).toBeTruthy();
    expect(
      screen.getByText(
        "No graded projections with both baselines for this scope.",
      ),
    ).toBeTruthy();
  });

  it("renders the insufficient-sample market state with the running count", () => {
    const { container } = renderThemed(
      <Accuracy
        accuracy={dto({
          market: { state: "insufficient", graded: 11, required: 30 },
        })}
      />,
    );
    expect(screen.getByText("insufficient sample")).toBeTruthy();
    expect(container.textContent).toContain("11 of 30 graded observations");
  });
});

describe("Accuracy screen — the private layer is absent, not hidden", () => {
  it("renders no overrides trace for a viewer payload", () => {
    const { container } = renderThemed(<Accuracy accuracy={dto()} />);
    expect(container.innerHTML).not.toMatch(/overrides/i);
  });

  it("renders the overrides entry only when the admin payload carries it", () => {
    const { container } = renderThemed(
      <Accuracy accuracy={dto({ overridesEntry: { decisionCount: 45 } })} />,
    );
    expect(screen.getByText("Overrides")).toBeTruthy();
    expect(container.innerHTML).toContain("/accuracy/overrides");
    expect(container.textContent).toContain("45 decisions");
  });
});

describe("ReliabilityCurve", () => {
  const points = populatedBuckets;

  it("is an image described by the bucket table, never animated", () => {
    renderThemed(
      <ReliabilityCurve
        series={[{ kind: "live", label: "Live", buckets: points }]}
        ariaSummaryId="bucket-table"
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-describedby")).toBe("bucket-table");
  });

  it("falls back to prose for degenerate data instead of drawing a misleading curve", () => {
    renderThemed(
      <ReliabilityCurve
        series={[
          {
            kind: "live",
            label: "Live",
            buckets: [
              bucket(0, {
                predictedMean: 0.05,
                observedRate: 0.06,
                thresholdObservations: 4,
                projectionCount: 2,
              }),
            ],
          },
        ]}
        ariaSummaryId="bucket-table"
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByText(/Not enough populated buckets to draw a curve/),
    ).toBeTruthy();
  });
});

describe("SampleSizePair", () => {
  it("renders both denominators as one primitive", () => {
    const { container } = renderThemed(
      <SampleSizePair observations={1847} projections={412} />,
    );
    expect(container.textContent).toContain("1,847 obs");
    expect(container.textContent).toContain("412 projections");
  });

  it("abbreviates without dropping either denominator", () => {
    const { container } = renderThemed(
      <SampleSizePair observations={214} projections={118} abbreviate />,
    );
    expect(container.textContent).toContain("214 obs");
    expect(container.textContent).toContain("118 proj");
  });
});
