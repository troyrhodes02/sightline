/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type { OverrideDecisionRowDto, OverridesDto } from "@/lib/dto/accuracy";
import { Overrides } from "./Overrides";

jest.mock("next/navigation", () => ({
  usePathname: () => "/accuracy/overrides",
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function row(
  overrides: Partial<OverrideDecisionRowDto> = {},
): OverrideDecisionRowDto {
  return {
    contractId: "c1",
    decidedAt: "2026-11-08T16:02:00.000Z",
    playerName: "Ja'Marr Chase",
    statType: "receiving_yards",
    threshold: 74.5,
    disposition: "took",
    edgeAtDecision: 7.4,
    edgeAtFinal: 8.1,
    timingCostPoints: 0.7,
    timingUnavailableReason: null,
    outcome: "won",
    sourcesDisagree: false,
    ...overrides,
  };
}

function dto(overrides: Partial<OverridesDto> = {}): OverridesDto {
  return {
    scope: { statType: "all", season: "all" },
    tiles: {
      took: { total: 3, settled: 2, won: 1, lost: 1, voided: 0, pending: 1 },
      faded: { total: 1, settled: 1, won: 1, lost: 0, voided: 0, pending: 0 },
      skipped: { total: 2, settledYes: 1, settledNo: 0, voided: 1, pending: 0 },
    },
    agreement: [
      {
        disposition: "took",
        recommended: { count: 2, won: 1 },
        notRecommended: { count: 1, won: 0 },
      },
      {
        disposition: "faded",
        recommended: { count: 1, won: 1 },
        notRecommended: { count: 0, won: 0 },
      },
      {
        disposition: "skipped",
        recommended: { count: 1, won: null },
        notRecommended: { count: 1, won: null },
      },
    ],
    timing: {
      medianPoints: 0.4,
      meanPoints: 0.7,
      measurable: 3,
      total: 4,
      unavailable: [{ reason: "missing_final_snapshot", count: 1 }],
    },
    decisions: [row()],
    ...overrides,
  };
}

const EMPTY: OverridesDto = dto({
  tiles: {
    took: { total: 0, settled: 0, won: 0, lost: 0, voided: 0, pending: 0 },
    faded: { total: 0, settled: 0, won: 0, lost: 0, voided: 0, pending: 0 },
    skipped: { total: 0, settledYes: 0, settledNo: 0, voided: 0, pending: 0 },
  },
  timing: {
    medianPoints: null,
    meanPoints: null,
    measurable: 0,
    total: 0,
    unavailable: [],
  },
  decisions: [],
});

describe("Overrides", () => {
  it("always renders the selection-bias statement — even empty", () => {
    const { unmount } = renderThemed(
      <Overrides overrides={dto()} availableSeasons={[2026]} />,
    );
    expect(
      screen.getByText(/William selects which contracts to mark/),
    ).toBeInTheDocument();
    unmount();

    renderThemed(<Overrides overrides={EMPTY} availableSeasons={[]} />);
    expect(
      screen.getByText(/William selects which contracts to mark/),
    ).toBeInTheDocument();
  });

  it("renders the three disposition tiles with settled, won/lost, voided, pending", () => {
    renderThemed(<Overrides overrides={dto()} availableSeasons={[2026]} />);
    expect(screen.getAllByText("took").length).toBeGreaterThan(0);
    expect(screen.getAllByText("skipped").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/settled 2 · won 1 ✓ · lost 1 ✗/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/graded on the side he preferred/),
    ).toBeInTheDocument();
  });

  it("keeps win/loss language out of the skipped tile entirely", () => {
    renderThemed(<Overrides overrides={dto()} availableSeasons={[2026]} />);
    expect(screen.getByText("no action taken")).toBeInTheDocument();
    expect(
      screen.getByText(/settled yes 1 · settled no 0/),
    ).toBeInTheDocument();
  });

  it("renders the agreement table with counts, won counts, and its caption", () => {
    renderThemed(<Overrides overrides={dto()} availableSeasons={[2026]} />);
    expect(screen.getByText("Against the recommendation")).toBeInTheDocument();
    expect(screen.getByText("2 (won 1)")).toBeInTheDocument();
    expect(
      screen.getByText(
        /per final pre-kickoff state · unmarked contracts excluded/,
      ),
    ).toBeInTheDocument();
  });

  it("states the timing sign convention beside the figures, always", () => {
    renderThemed(<Overrides overrides={dto()} availableSeasons={[2026]} />);
    expect(
      screen.getByText(/positive = the final pre-kickoff edge exceeded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/median \+0\.4 pts/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /3 of 4 decisions measurable · 1 unavailable: 1 no final snapshot/,
      ),
    ).toBeInTheDocument();
  });

  it("links each decision row to its contract", () => {
    renderThemed(<Overrides overrides={dto()} availableSeasons={[2026]} />);
    const links = screen.getAllByRole("link", {
      name: /Ja'Marr Chase · rec yds ≥ 74\.5/,
    });
    expect(links[0]).toHaveAttribute("href", "/slate/c1");
  });

  it("chips a disagreement and a missing final snapshot on their rows", () => {
    renderThemed(
      <Overrides
        overrides={dto({
          decisions: [
            row({ sourcesDisagree: true }),
            row({
              contractId: "c2",
              edgeAtFinal: null,
              timingCostPoints: null,
              timingUnavailableReason: "missing_final_snapshot",
            }),
          ],
        })}
        availableSeasons={[2026]}
      />,
    );
    expect(screen.getAllByText("sources disagree").length).toBeGreaterThan(0);
    expect(screen.getAllByText("no final snapshot").length).toBeGreaterThan(0);
  });

  it("empty scope: the designed empty state, not an error", () => {
    renderThemed(<Overrides overrides={EMPTY} availableSeasons={[]} />);
    expect(
      screen.getByText("No decisions logged for this scope."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Against the recommendation"),
    ).not.toBeInTheDocument();
  });

  it("pending-but-not-empty: tiles render with counts and pending chips", () => {
    renderThemed(
      <Overrides
        overrides={dto({
          tiles: {
            took: {
              total: 2,
              settled: 0,
              won: 0,
              lost: 0,
              voided: 0,
              pending: 2,
            },
            faded: {
              total: 0,
              settled: 0,
              won: 0,
              lost: 0,
              voided: 0,
              pending: 0,
            },
            skipped: {
              total: 1,
              settledYes: 0,
              settledNo: 0,
              voided: 0,
              pending: 1,
            },
          },
          timing: {
            medianPoints: null,
            meanPoints: null,
            measurable: 2,
            total: 2,
            unavailable: [],
          },
          decisions: [row({ outcome: "pending" })],
        })}
        availableSeasons={[2026]}
      />,
    );
    expect(
      screen.queryByText("No decisions logged for this scope."),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("pending").length).toBeGreaterThanOrEqual(2);
  });
});
