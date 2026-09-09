/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";

import { AutonomyOverview } from "./AutonomyOverview";
import { AutonomyCycleDetail, AutonomyCycles } from "./AutonomyCycles";
import { AutonomyPositions } from "./AutonomyPositions";
import { AutonomyOverride } from "./AutonomyOverride";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type {
  ActiveBreachesDto,
  AutonomyOverviewDto,
  BreachDto,
  CandidateDto,
  CycleDetailDto,
  PositionRowDto,
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

function overview(
  over: Partial<AutonomyOverviewDto> = {},
): AutonomyOverviewDto {
  return {
    status: "active",
    killSwitchEngaged: false,
    autonomyEnabled: true,
    mode: MODE,
    figures: {
      startingBankrollCents: 100_000,
      settledBalanceCents: 87_410,
      openExposureCents: 3_830,
      activeBankroll: { cents: 91_240 },
      cumulativeWithdrawalsCents: 15_000,
      totalPaperWealth: { cents: 106_240 },
      netPaperPnl: { cents: -8_760 },
      maxDrawdownBps: 1_124,
      highWaterMarkCents: 102_790,
      markToMarketAvailable: true,
      priceLastFetchedAt: "2026-10-26T17:32:00.000Z",
    },
    exposure: {
      slate: {
        key: "slate",
        label: "Slate",
        usedCents: 3_830,
        capCents: 13_686,
        capPct: 15,
      },
      games: [],
    },
    history: [
      {
        at: "2026-10-05T12:00:00.000Z",
        settledCents: 100_000,
        markCents: null,
      },
      { at: "2026-10-26T12:00:00.000Z", settledCents: 87_410, markCents: null },
    ],
    breaches: [],
    recentCycles: [],
    readiness: {
      state: "paper_evidence_building",
      weeksComplete: 1,
      weeksRequired: 2,
    },
    emptyReason: null,
    nextWindowOpensAt: "2026-11-02T12:00:00.000Z",
    lastCycleAt: null,
    ...over,
  };
}

describe("Autonomy overview", () => {
  it("discloses paper mode on the surface itself", () => {
    // A permanent label, not a temporary one pending live mode.
    draw(<AutonomyOverview overview={overview()} />);
    expect(
      screen.getByText(/Paper mode · all figures simulated/i),
    ).toBeInTheDocument();
  });

  it("decomposes the active bankroll rather than only totalling it", () => {
    draw(<AutonomyOverview overview={overview()} />);
    expect(screen.getByText("$912.40")).toBeInTheDocument();
    expect(
      screen.getByText(/settled \$874.10 \+ open \$38.30/),
    ).toBeInTheDocument();
  });

  it("prints the sign on a negative P&L, not only the colour", () => {
    // The encoding has to survive greyscale and colourblindness.
    draw(<AutonomyOverview overview={overview()} />);
    expect(screen.getByText("−$87.60")).toBeInTheDocument();
  });

  it("renders drawdown as unavailable — never zero — when the mark cannot be computed", () => {
    draw(
      <AutonomyOverview
        overview={overview({
          figures: {
            ...overview().figures,
            markToMarketAvailable: false,
            maxDrawdownBps: null,
            activeBankroll: { unavailable: true },
            totalPaperWealth: { unavailable: true },
            netPaperPnl: { unavailable: true },
          },
        })}
      />,
    );
    expect(screen.getAllByText("unavailable").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Mark-to-market, and therefore drawdown, cannot be computed/i,
      ),
    ).toBeInTheDocument();
  });

  it("states the ceiling is independent of risk mode, in words", () => {
    draw(<AutonomyOverview overview={overview()} />);
    expect(screen.getByText(/independent of risk mode/i)).toBeInTheDocument();
  });

  it("shows every simultaneous breach, and disables Resume while any halts", () => {
    draw(
      <AutonomyOverview
        overview={overview({
          status: "halted",
          breaches: [
            breach(),
            breach({
              id: "b2",
              condition: "calibration",
              label: "calibration",
            }),
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/drawdown halt — measured 11.2%/),
    ).toBeInTheDocument();
    expect(screen.getByText(/calibration — measured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /Force override/ }),
    ).toHaveAttribute("href", "/autonomy/override");
  });

  it("renders the readiness chip with no adjacent action", () => {
    // Eligibility is a report, not a call to action.
    draw(<AutonomyOverview overview={overview()} />);
    expect(screen.getByText("paper evidence building")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /activate|go live|enable live/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the not-enabled empty state without a zeroed dashboard", () => {
    draw(
      <AutonomyOverview
        overview={overview({
          autonomyEnabled: false,
          emptyReason: "not_enabled",
        })}
      />,
    );
    expect(
      screen.getByText(/Autonomous paper trading is not enabled/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bankroll history")).not.toBeInTheDocument();
  });

  it("keeps the kill switch present when there is no campaign at all", () => {
    // The control that stops the bot must never be missing because a read
    // returned nothing.
    draw(<AutonomyOverview overview={null} />);
    expect(
      screen.getByText(/Autonomous paper trading is not set up/),
    ).toBeInTheDocument();
  });
});

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

function position(over: Partial<PositionRowDto> = {}): PositionRowDto {
  return {
    positionId: "p1",
    contractId: "k1",
    playerName: "Ja'Marr Chase",
    statType: "receiving_yards",
    threshold: 74.5,
    side: "yes",
    contracts: 32,
    costBasisCents: 1_728,
    feesPaidCents: 32,
    intendedStakeCents: 1_775,
    unfilledStakeCents: 0,
    markCents: 1_920,
    status: "open",
    settlementResult: null,
    realizedPnlCents: null,
    openedAt: "2026-10-26T16:20:00.000Z",
    settledAt: null,
    ...over,
  };
}

describe("Positions", () => {
  it("renders P&L as `—` while a position is open", () => {
    // Unrealised value never enters the realised-P&L column.
    draw(
      <AutonomyPositions
        rows={[position()]}
        status="open"
        openCount={1}
        settledCount={0}
      />,
    );
    const row = screen.getByText(/Ja'Marr Chase/).closest("tr");
    expect(within(row as HTMLElement).getAllByText("—").length).toBeGreaterThan(
      0,
    );
  });

  it("keeps the intended stake beside the fill, permanently", () => {
    draw(
      <AutonomyPositions
        rows={[position({ unfilledStakeCents: 625 })]}
        status="open"
        openCount={1}
        settledCount={0}
      />,
    );
    expect(screen.getByText(/intended \$17.75/)).toBeInTheDocument();
    expect(screen.getByText(/partial — \$6.25 unfilled/)).toBeInTheDocument();
  });

  it("renders a voided market distinctly from a loss", () => {
    draw(
      <AutonomyPositions
        rows={[
          position({
            status: "voided",
            settlementResult: "voided",
            realizedPnlCents: 0,
            markCents: null,
            settledAt: "2026-10-27T12:00:00.000Z",
          }),
        ]}
        status="settled"
        openCount={0}
        settledCount={1}
      />,
    );
    expect(screen.getByText("voided")).toBeInTheDocument();
    expect(
      screen.getByText(/cost basis and fees returned/),
    ).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("renders an unavailable mark as text, not as zero", () => {
    draw(
      <AutonomyPositions
        rows={[position({ markCents: null })]}
        status="open"
        openCount={1}
        settledCount={0}
      />,
    );
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });

  it("states the settlement-source rule on the surface", () => {
    draw(
      <AutonomyPositions
        rows={[]}
        status="open"
        openCount={0}
        settledCount={0}
      />,
    );
    expect(
      screen.getByText(
        /the position follows Kalshi and the model's grade follows the official/i,
      ),
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
