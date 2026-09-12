/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { LeaderChip } from "./LeaderChip";
import { EvidenceChip } from "./EvidenceChip";
import { RecommendationCard } from "./RecommendationCard";
import { PortfolioScorecard } from "./PortfolioScorecard";
import { ComparisonBarChart } from "./ComparisonBarChart";
import { ModelPerformance } from "@/components/screens/ModelPerformance";
import type {
  LeaderState,
  ModelComparisonDto,
  ModelPerformanceDto,
  PortfolioScorecardDto,
  StatLeaderRowDto,
} from "@/lib/dto/model-eval";
import type { AccuracyDto } from "@/lib/dto/accuracy";

jest.mock("next/navigation", () => ({
  usePathname: () => "/model-performance",
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const SIM = "simulation-mc-0.1.0";
const BASE = "baseline-zil-0.1.0";

// ---------------------------------------------------------------------------
// LeaderChip — the four-state closed vocabulary (D14)
// ---------------------------------------------------------------------------

describe("LeaderChip — four states with margin + counts (D14)", () => {
  function chip(leader: LeaderState, brierMargin: number | null) {
    return renderThemed(
      <LeaderChip
        leader={leader}
        brierMargin={brierMargin}
        liveObservations={96}
        backtestObservations={4812}
        simulationModelVersion={SIM}
        baselineModelVersion={BASE}
      />,
    );
  }

  it("simulation_leads names the model and carries margin + both counts", () => {
    const { container } = chip("simulation_leads", 0.013);
    expect(screen.getByText("Simulation Engine leads")).toBeTruthy();
    expect(container.textContent).toContain("0.013");
    expect(container.textContent).toContain("Live 96 obs");
    expect(container.textContent).toContain("Backtest 4,812 obs");
  });

  it("baseline_leads names the model and carries margin + both counts", () => {
    const { container } = chip("baseline_leads", 0.02);
    expect(screen.getByText("Baseline leads")).toBeTruthy();
    expect(container.textContent).toContain("0.020");
    expect(container.textContent).toContain("Live 96 obs");
    expect(container.textContent).toContain("Backtest 4,812 obs");
  });

  it("too_close_to_call is neutral and still carries margin + counts", () => {
    const { container } = chip("too_close_to_call", 0.004);
    expect(screen.getByText("Too close to call")).toBeTruthy();
    expect(container.textContent).toContain("0.004");
    expect(container.textContent).toContain("Live 96 obs");
  });

  it("not_enough_evidence shows the state without an unqualified rate", () => {
    const { container } = chip("not_enough_evidence", null);
    expect(screen.getByText("Not enough evidence")).toBeTruthy();
    // No margin/count line for the no-evidence state — evidence is what it lacks.
    expect(container.textContent).not.toContain("Live 96 obs");
  });
});

// ---------------------------------------------------------------------------
// EvidenceChip — count always present; below-floor stated in words (D8)
// ---------------------------------------------------------------------------

describe("EvidenceChip", () => {
  it("renders the strength word with its count", () => {
    const { container } = renderThemed(
      <EvidenceChip strength="moderate" sampleSize={120} />,
    );
    expect(container.textContent).toContain("moderate");
    expect(container.textContent).toContain("120 obs");
  });

  it("states below-floor in words, not colour alone", () => {
    const { container } = renderThemed(
      <EvidenceChip strength="limited" sampleSize={18} belowFloor floor={50} />,
    );
    expect(container.textContent).toContain("limited");
    expect(container.textContent).toContain("n<50");
  });
});

// ---------------------------------------------------------------------------
// RecommendationCard — read-only, one navigational link, no apply (D12)
// ---------------------------------------------------------------------------

describe("RecommendationCard — no config-writing control (D12)", () => {
  it("renders prose and a single navigational link to Settings, no button", () => {
    const { container } = renderThemed(
      <RecommendationCard
        recommendation={{
          leader: "simulation_leads",
          canRecommend: true,
          recommendedModelVersion: SIM,
          text: "Simulation Engine leads on moderate live evidence.",
        }}
      />,
    );
    expect(container.textContent).toContain("Simulation Engine leads");
    // The only affordance is a link to Settings — never an apply/toggle button.
    const link = screen.getByText("Review selection →");
    expect(link.closest("a")?.getAttribute("href")).toBe("/autonomy/settings");
    expect(container.querySelector("button")).toBeNull();
    expect(container.innerHTML).not.toMatch(/apply|use this model/i);
  });

  it("carries the standing financial-vs-quality separation sentence (D17)", () => {
    const { container } = renderThemed(
      <RecommendationCard
        recommendation={{
          leader: "not_enough_evidence",
          canRecommend: false,
          recommendedModelVersion: null,
          text: "Not enough live evidence yet.",
        }}
      />,
    );
    expect(container.textContent).toContain("model quality is judged on");
  });
});

// ---------------------------------------------------------------------------
// PortfolioScorecard — money neutral, only P&L sign coloured (D19), counts (D5)
// ---------------------------------------------------------------------------

function scorecard(
  overrides: Partial<PortfolioScorecardDto> = {},
): PortfolioScorecardDto {
  return {
    portfolio: "simulation",
    startingBankrollCents: 100_000,
    activeBankrollCents: 112_000,
    withdrawnCents: 0,
    totalValueCents: 112_000,
    netPnlCents: 12_000,
    returnPct: 12,
    maxDrawdownBps: 340,
    candidatesEvaluated: 58,
    candidatesSized: 22,
    positionCount: 22,
    riskMode: "moderate",
    breakerEventCount: 0,
    ...overrides,
  };
}

describe("PortfolioScorecard (D5/D19/D20)", () => {
  it("labels the figures as paper and shows both opportunity counts", () => {
    const { container } = renderThemed(
      <PortfolioScorecard scorecard={scorecard()} />,
    );
    expect(screen.getByText("paper")).toBeTruthy();
    expect(container.textContent).toContain("evaluated 58");
    expect(container.textContent).toContain("sized 22");
    expect(container.textContent).toContain("22 pos");
  });

  it("shows a signed P&L with its sign glyph", () => {
    const { container } = renderThemed(
      <PortfolioScorecard
        scorecard={scorecard({ netPnlCents: -4200, returnPct: -4.2 })}
      />,
    );
    expect(container.textContent).toContain("−$42.00");
  });

  it("renders 'unavailable', not zero, when mark-to-market is degraded", () => {
    const { container } = renderThemed(
      <PortfolioScorecard
        scorecard={scorecard({
          activeBankrollCents: null,
          totalValueCents: null,
          netPnlCents: null,
          returnPct: null,
          maxDrawdownBps: null,
        })}
      />,
    );
    expect(container.textContent).toContain("unavailable");
  });
});

describe("ComparisonBarChart", () => {
  it("falls back to prose for a null Brier rather than a zero bar", () => {
    const { container } = renderThemed(
      <ComparisonBarChart baselineBrier={null} simulationBrier={0.21} />,
    );
    expect(container.textContent).toContain("Not enough evidence");
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("distinguishes the two series by stroke and label, and names the better one", () => {
    const { container } = renderThemed(
      <ComparisonBarChart baselineBrier={0.238} simulationBrier={0.217} />,
    );
    expect(container.textContent).toContain("Baseline 0.238 (dashed)");
    expect(container.textContent).toContain("Simulation 0.217 (solid)");
    expect(container.textContent).toContain("Simulation is better calibrated");
  });
});

// ---------------------------------------------------------------------------
// ModelPerformance screen — levels, floor, no-campaign state
// ---------------------------------------------------------------------------

function comparison(
  record: "live" | "backtest",
  overrides: Partial<ModelComparisonDto> = {},
): ModelComparisonDto {
  return {
    record,
    population: "contract_like",
    leader: "simulation_leads",
    baselineBrier: 0.224,
    simulationBrier: 0.211,
    brierMargin: 0.013,
    baselineModelVersion: BASE,
    simulationModelVersion: SIM,
    liveObservations: record === "live" ? 96 : 0,
    backtestObservations: record === "backtest" ? 4812 : 0,
    evidence: "moderate",
    ...overrides,
  };
}

function statLeader(
  overrides: Partial<StatLeaderRowDto> = {},
): StatLeaderRowDto {
  return {
    statType: "passing_yards",
    leader: "simulation_leads",
    brierMargin: 0.018,
    sampleSize: 58,
    evidence: "moderate",
    belowFloor: false,
    ...overrides,
  };
}

function mpDto(
  overrides: Partial<ModelPerformanceDto> = {},
): ModelPerformanceDto {
  return {
    overallLive: comparison("live"),
    overallBacktest: comparison("backtest"),
    recommendation: {
      leader: "simulation_leads",
      canRecommend: true,
      recommendedModelVersion: SIM,
      text: "Simulation Engine leads on moderate live evidence.",
    },
    statLeadersLive: [
      statLeader(),
      statLeader({
        statType: "receptions",
        leader: "not_enough_evidence",
        brierMargin: null,
        sampleSize: 18,
        evidence: "limited",
        belowFloor: true,
      }),
    ],
    statLeadersBacktest: [statLeader({ sampleSize: 4812 })],
    scorecards: [scorecard({ portfolio: "baseline" }), scorecard()],
    readiness: {
      state: "paper_evidence_building",
      weeksComplete: 1,
      weeksRequired: 2,
    },
    hybridSelected: false,
    projectionAccuracy: [],
    ...overrides,
  };
}

// A minimal AccuracyDto for the Advanced level (its own tests cover its body).
function accuracyDto(): AccuracyDto {
  return {
    scope: {
      record: "live",
      modelVersion: "v1",
      population: "contract_like",
      statType: "all",
      season: "all",
    },
    gradedThroughWeek: { season: 2026, week: 9 },
    lastGradingCycleAt: "2026-01-04T04:40:00.000Z",
    gradingDelayed: false,
    calibration: [],
    errorPanel: null,
    market: { state: "insufficient", graded: 0, required: 30 },
    exclusions: [],
    availableVersions: ["v1"],
    availableSeasons: [2026],
  };
}

describe("ModelPerformance — Summary level", () => {
  it("shows the level tabs and the overall leader for both records (D15)", () => {
    const { container } = renderThemed(
      <ModelPerformance
        level="summary"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    expect(screen.getByText("Model Performance")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Summary" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Breakdown" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeTruthy();
    // Both records are named, never blended.
    expect(container.textContent).toContain("Live:");
    expect(container.textContent).toContain("Backtest:");
  });

  it("renders the recommendation card with a link and no apply control (D12)", () => {
    const { container } = renderThemed(
      <ModelPerformance
        level="summary"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    expect(screen.getByText("Review selection →")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/apply recommendation/i);
  });

  it("shows the three scorecards and the opportunity-set caption (D5)", () => {
    const { container } = renderThemed(
      <ModelPerformance
        level="summary"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    expect(container.textContent).toContain(
      "Portfolios may evaluate different opportunity sets",
    );
    expect(container.textContent).toContain("evaluated 58");
  });

  it("renders the no-campaign state (link to Settings) when scorecards are null", () => {
    renderThemed(
      <ModelPerformance
        level="summary"
        modelPerformance={mpDto({ scorecards: null, readiness: null })}
        accuracy={accuracyDto()}
      />,
    );
    expect(screen.getByText("No paper campaign yet.")).toBeTruthy();
    expect(screen.getByText("Open Paper Bot settings")).toBeTruthy();
  });

  it("renders the readiness strip as a link, never a control", () => {
    const { container } = renderThemed(
      <ModelPerformance
        level="summary"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    expect(container.textContent).toContain("Real-money readiness");
    expect(container.textContent).toContain("1 of 2 weeks");
    expect(screen.getByText("View readiness detail →")).toBeTruthy();
  });

  it("shows a not-enough-evidence stat leader without an unqualified rate", () => {
    const { container } = renderThemed(
      <ModelPerformance
        level="summary"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    // The thin receptions row shows the state and n<50, never a bare margin.
    expect(screen.getByText("Not enough evidence")).toBeTruthy();
    expect(container.textContent).toContain("n<50");
  });
});

describe("ModelPerformance — Breakdown level (D8/D16)", () => {
  it("defaults to the stat facet and shows every leader with its evidence", () => {
    window.history.replaceState({}, "", "/model-performance?level=breakdown");
    const { container } = renderThemed(
      <ModelPerformance
        level="breakdown"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    expect(screen.getByRole("button", { name: "Stat type" })).toBeTruthy();
    expect(container.textContent).toContain("Passing yards");
    expect(container.textContent).toContain("Receptions");
  });

  it("never renders a probability-bucket rate below 30 obs — insufficient state, not a blank (D8)", () => {
    window.history.replaceState(
      {},
      "",
      "/model-performance?level=breakdown&facet=probability",
    );
    const { container } = renderThemed(
      <ModelPerformance
        level="breakdown"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    // The honest insufficient-evidence position, naming the 30-obs floor.
    expect(container.textContent).toContain("no bucket renders below 30");
    // Probability is a percentage axis, never a confidence word (D16).
    expect(container.textContent).toContain(
      "Probability ranges are percentages",
    );
  });

  it("keeps confidence lexical (words), never conflated with probability (D16)", () => {
    window.history.replaceState(
      {},
      "",
      "/model-performance?level=breakdown&facet=confidence",
    );
    const { container } = renderThemed(
      <ModelPerformance
        level="breakdown"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    expect(container.textContent).toContain("low / medium / high");
  });
});

describe("ModelPerformance — Advanced level (D9)", () => {
  it("nests the preserved Accuracy surface without a second heading", () => {
    const { container } = renderThemed(
      <ModelPerformance
        level="advanced"
        modelPerformance={mpDto()}
        accuracy={accuracyDto()}
      />,
    );
    // One page heading (Model Performance); the nested Accuracy omits its own.
    const headings = screen.getAllByText(/Model Performance|Accuracy/);
    expect(headings.filter((h) => h.textContent === "Accuracy").length).toBe(0);
    // The Accuracy body renders its scope bar.
    expect(container.textContent).toContain("Against the market");
  });
});

// ---------------------------------------------------------------------------
// Projection accuracy facet (Breakdown) — point-estimate error per engine
// ---------------------------------------------------------------------------

describe("Projection accuracy facet", () => {
  function renderFacet(rows: ModelPerformanceDto["projectionAccuracy"]) {
    window.history.replaceState(
      {},
      "",
      "/model-performance?level=breakdown&facet=projection_accuracy",
    );
    return renderThemed(
      <ModelPerformance
        level="breakdown"
        modelPerformance={mpDto({ projectionAccuracy: rows })}
        accuracy={accuracyDto()}
      />,
    );
  }

  it("shows each engine's MAE + obs and names the closer engine", () => {
    const { container } = renderFacet([
      {
        statType: "receiving_yards",
        baseline: { mae: 12.4, rmse: 16, count: 210 },
        simulation: { mae: 11.8, rmse: 15.2, count: 95 },
        closer: "simulation",
      },
    ]);
    expect(container.textContent).toContain("off by 12.4 yds on avg");
    expect(container.textContent).toContain("off by 11.8 yds on avg");
    expect(container.textContent).toContain("210 obs");
    expect(container.textContent).toContain("Simulation projects closer here.");
  });

  it("renders — for an engine with no grades and the one-engine line", () => {
    const { container } = renderFacet([
      {
        statType: "rushing_yards",
        baseline: { mae: 9, rmse: 11, count: 148 },
        simulation: null,
        closer: null,
      },
    ]);
    expect(container.textContent).toContain(
      "Only one engine has graded predictions so far.",
    );
    expect(container.textContent).toContain("—");
  });

  it("shows the numbers but withholds a winner below the 30 floor", () => {
    const { container } = renderFacet([
      {
        statType: "passing_yards",
        baseline: { mae: 40, rmse: 55, count: 20 },
        simulation: { mae: 30, rmse: 42, count: 12 },
        closer: null,
      },
    ]);
    expect(container.textContent).toContain("off by 40.0 yds on avg");
    expect(container.textContent).toContain(
      "Not enough graded predictions to compare yet",
    );
  });

  it("is empty when no engine has any graded projections", () => {
    const { container } = renderFacet([
      {
        statType: "receptions",
        baseline: null,
        simulation: null,
        closer: null,
      },
    ]);
    expect(container.textContent).toContain("No graded projections yet");
  });
});
