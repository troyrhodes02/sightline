/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

import { AutonomyCycleDetail, AutonomyCycles } from "./AutonomyCycles";
import { AutonomyOverride } from "./AutonomyOverride";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type {
  ActiveBreachesDto,
  BreachDto,
  CandidateDto,
  CycleDetailDto,
} from "@/lib/dto/autonomy";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

function draw(node: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);
}

const MODE = {
  mode: "conservative" as const,
  kellyFraction: 0.25,
  perGameCapPct: 5,
  perSlateCapPct: 15,
  drawdownWarnPct: 5,
  drawdownHaltPct: 10,
  probabilityCeiling: 0.75,
  withdrawalCeilingMultiple: 1.5,
};

function breach(over: Partial<BreachDto> = {}): BreachDto {
  return {
    id: "b1",
    condition: "drawdown_halt",
    label: "drawdown halt",
    conditionDescription: "active bankroll below the high-water mark",
    measuredDisplay: "11.2%",
    thresholdDisplay: "10.0% (conservative)",
    trippedAt: "2026-10-26T17:47:00.000Z",
    resolution: "active",
    resolvedAt: null,
    resolvedByDisplayName: null,
    halts: true,
    ...over,
  };
}

describe("Cycles", () => {
  it("shows a skipped cycle as a row with its reason, not an error", () => {
    draw(
      <AutonomyCycles
        rows={[
          {
            cycleId: "c1",
            startedAt: "2026-10-26T19:55:00.000Z",
            gameLabel: "KC @ BUF",
            kickoffAt: "2026-10-27T00:20:00.000Z",
            outcome: "skipped",
            reason: "pre_kickoff_cutoff",
            candidatesEvaluated: null,
            candidatesSized: null,
            candidatesFilled: null,
            stakedCents: null,
          },
        ]}
        seasons={[2026]}
        weeks={[9]}
        season={2026}
        week={9}
      />,
    );
    expect(screen.getByText("skipped")).toBeInTheDocument();
    expect(screen.getByText("pre_kickoff_cutoff")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders an empty cycles list as a designed state", () => {
    draw(
      <AutonomyCycles
        rows={[]}
        seasons={[]}
        weeks={[]}
        season={null}
        week={null}
      />,
    );
    expect(
      screen.getByText("No autonomous cycles recorded."),
    ).toBeInTheDocument();
  });
});

function candidate(over: Partial<CandidateDto> = {}): CandidateDto {
  return {
    contractId: "k1",
    rank: 0,
    playerName: "Ja'Marr Chase",
    teamAbbreviation: null,
    statType: "receiving_yards",
    threshold: 74.5,
    rawProbability: 0.614,
    correctedProbability: 0.589,
    confidence: "high",
    side: "yes",
    askCents: 54,
    feeCents: 32,
    netPriceCents: 56,
    topOfBookSizeContracts: 40,
    kellyEdge: 0.071,
    kellyFractionApplied: 0.25,
    intendedStakeCents: 1_775,
    intendedContracts: 32,
    filledContracts: 32,
    filledCostCents: 1_728,
    filledFeeCents: 32,
    unfilledStakeCents: 0,
    verdict: "filled",
    boundBy: "none",
    boundByDetail: null,
    ...over,
  };
}

function cycleDetail(candidates: CandidateDto[]): CycleDetailDto {
  return {
    cycleId: "c1",
    gameLabel: "CIN @ PIT",
    kickoffAt: "2026-10-26T17:00:00.000Z",
    startedAt: "2026-10-26T16:20:00.000Z",
    finishedAt: "2026-10-26T16:20:05.000Z",
    outcome: "partial_fill",
    reason: null,
    mode: MODE,
    recalibration: {
      version: 3,
      backtestLabel: "2019–2024",
      liveObservationCount: 412,
    },
    bankrollAtEvaluationCents: 99_980,
    slateCapacityCents: 14_997,
    gameCapacityCents: 4_999,
    candidates,
    allocationTrace: ["Pass 1 — allocated Chase 32/32 contracts, $17.60."],
  };
}

describe("Cycle detail", () => {
  it("renders a bound-by for every candidate, including `none`", () => {
    // The audit trail's one non-negotiable field. A blank would read as "we
    // did not check".
    draw(
      <AutonomyCycleDetail
        detail={cycleDetail([
          candidate(),
          candidate({
            contractId: "k2",
            rank: 1,
            playerName: "Najee Harris",
            verdict: "no_stake",
            boundBy: "probability_ceiling",
            boundByDetail: "0.750",
            filledContracts: 0,
            filledCostCents: 0,
            filledFeeCents: 0,
            intendedContracts: 0,
            intendedStakeCents: 0,
          }),
        ])}
      />,
    );
    expect(screen.getAllByText(/bound by:/)).toHaveLength(2);
    expect(screen.getByText(/none/)).toBeInTheDocument();
    expect(screen.getByText(/probability ceiling — 0.750/)).toBeInTheDocument();
  });

  it("shows intended and filled together on a partial fill", () => {
    draw(
      <AutonomyCycleDetail
        detail={cycleDetail([
          candidate({
            verdict: "partial",
            boundBy: "top_of_book_size",
            topOfBookSizeContracts: 12,
            filledContracts: 12,
            filledCostCents: 588,
            filledFeeCents: 12,
            unfilledStakeCents: 625,
          }),
        ])}
      />,
    );
    expect(
      screen.getByText(/intended \$17.75 \(32 contracts\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/filled 12 @ 54¢/)).toBeInTheDocument();
    expect(
      screen.getByText(/unfilled \$6.25 returned to available bankroll/),
    ).toBeInTheDocument();
  });

  it("shows the raw probability beside the corrected one", () => {
    draw(<AutonomyCycleDetail detail={cycleDetail([candidate()])} />);
    expect(screen.getByText(/61.4%/)).toBeInTheDocument();
    expect(screen.getByText(/58.9%/)).toBeInTheDocument();
  });

  it("names the recalibration version the cycle ran under", () => {
    draw(<AutonomyCycleDetail detail={cycleDetail([candidate()])} />);
    expect(screen.getByText(/v3 — 2019–2024/)).toBeInTheDocument();
  });

  it("renders a no-candidate cycle as a completed cycle", () => {
    draw(<AutonomyCycleDetail detail={cycleDetail([])} />);
    expect(
      screen.getByText("No resolvable contracts in this game window."),
    ).toBeInTheDocument();
  });
});

describe("Force override", () => {
  function data(over: Partial<ActiveBreachesDto> = {}): ActiveBreachesDto {
    return {
      campaignExists: true,
      killSwitchEngaged: false,
      breaches: [
        breach(),
        breach({ id: "b2", condition: "calibration", label: "calibration" }),
      ],
      ...over,
    };
  }

  it("disables the action until EVERY breach is acknowledged", () => {
    draw(<AutonomyOverride data={data()} />);
    const action = screen.getByRole("button", {
      name: "Force override and resume",
    });
    expect(action).toBeDisabled();
    expect(
      screen.getByText("0 of 2 breaches acknowledged."),
    ).toBeInTheDocument();
  });

  it("renders all four facts for each breach before the action is available", () => {
    draw(<AutonomyOverride data={data()} />);
    expect(screen.getAllByText("condition")).toHaveLength(2);
    expect(screen.getAllByText("measured")).toHaveLength(2);
    expect(screen.getAllByText("threshold")).toHaveLength(2);
    expect(screen.getAllByText("tripped")).toHaveLength(2);
  });

  it("gives each condition its own checkbox, not one generic acknowledgement", () => {
    draw(<AutonomyOverride data={data()} />);
    expect(
      screen.getByRole("checkbox", { name: "Override drawdown halt" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Override calibration" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /I understand/i }),
    ).not.toBeInTheDocument();
  });

  it("never labels the action Resume", () => {
    draw(<AutonomyOverride data={data()} />);
    expect(
      screen.queryByRole("button", { name: "Resume" }),
    ).not.toBeInTheDocument();
  });

  it("says the breaker is not disabled by an override", () => {
    draw(<AutonomyOverride data={data()} />);
    expect(screen.getByText(/this does not disable it/i)).toBeInTheDocument();
  });

  it("refuses entirely while the kill switch is engaged", () => {
    draw(<AutonomyOverride data={data({ killSwitchEngaged: true })} />);
    expect(
      screen.getByText(/Disengage it before resuming/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Force override and resume" }),
    ).not.toBeInTheDocument();
  });

  it("directs to Resume when nothing is breached", () => {
    draw(<AutonomyOverride data={data({ breaches: [] })} />);
    expect(
      screen.getByText("No active breach to override."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/use Resume on the overview instead/i),
    ).toBeInTheDocument();
  });
});
