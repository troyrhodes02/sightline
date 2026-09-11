/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import { ModelTrackRecordBlock } from "./ModelTrackRecordBlock";
import type { ContractTrackRecordDto } from "@/lib/dto/model-eval";

/**
 * The viewer track-record block (Screen 4, D8/D16/D18/D22). The only
 * model-quality surface a viewer sees — the assertions here are that it renders
 * an honest rate above the floor, an honest running count below it, the building
 * state before any evidence, and never a leader / shadow / bankroll / admin link.
 */

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const BASE: ContractTrackRecordDto = {
  modelProbability: 0.74,
  confidence: "high",
  statType: "receiving_yards",
  rangeLabel: "70–80%",
  rangeObservedRate: 0.72,
  rangeSampleSize: 184,
  trackRecord: "strong",
  statObservations: 2500,
  belowFloor: false,
};

describe("above the floor", () => {
  it("renders the observed rate with its sample size", () => {
    renderThemed(
      <ModelTrackRecordBlock dto={BASE} statType="receiving_yards" />,
    );
    expect(screen.getByText(/72%/)).toBeInTheDocument();
    expect(screen.getByText(/across/)).toBeInTheDocument();
    expect(screen.getByText("184")).toBeInTheDocument();
  });

  it("shows probability as a % and confidence as a word, never conflated (D16)", () => {
    renderThemed(
      <ModelTrackRecordBlock dto={BASE} statType="receiving_yards" />,
    );
    // Probability is a percentage.
    expect(screen.getByText("74.0%")).toBeInTheDocument();
    // Confidence is a labelled word, not a percentage.
    expect(screen.getByText("confidence")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("renders the stat-type track-record label", () => {
    renderThemed(
      <ModelTrackRecordBlock dto={BASE} statType="receiving_yards" />,
    );
    expect(
      screen.getByText(/Receiving yards track record/),
    ).toBeInTheDocument();
    expect(screen.getByText("strong")).toBeInTheDocument();
  });
});

describe("below the floor (D8)", () => {
  it("states there is not enough evidence with the running count, never a rate", () => {
    const belowFloor: ContractTrackRecordDto = {
      ...BASE,
      rangeObservedRate: null,
      rangeSampleSize: 18,
      trackRecord: "limited",
      belowFloor: true,
    };
    renderThemed(
      <ModelTrackRecordBlock dto={belowFloor} statType="receiving_yards" />,
    );
    expect(
      screen.getByText(/Not enough graded predictions/),
    ).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    // No fabricated percentage in the range sentence.
    expect(screen.queryByText(/of the time/)).not.toBeInTheDocument();
  });
});

describe("building state", () => {
  it("renders 'building' with the count so far when no graded evidence exists", () => {
    renderThemed(
      <ModelTrackRecordBlock
        dto={null}
        statType="receiving_yards"
        buildingCount={4}
      />,
    );
    expect(screen.getByText("building")).toBeInTheDocument();
    expect(screen.getByText(/4 so far/)).toBeInTheDocument();
  });
});

describe("viewer-safety (D18/D22)", () => {
  it("renders no leader, shadow, bankroll, or admin link", () => {
    const { container } = renderThemed(
      <ModelTrackRecordBlock dto={BASE} statType="receiving_yards" />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/leader/i);
    expect(text).not.toMatch(/shadow/i);
    expect(text).not.toMatch(/baseline/i);
    expect(text).not.toMatch(/simulation/i);
    expect(text).not.toMatch(/bankroll/i);
    expect(text).not.toMatch(/\$/);
    // No anchor to an admin surface (or anywhere).
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
