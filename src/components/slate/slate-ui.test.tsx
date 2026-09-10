/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type { SlateDto, SlateRowDto } from "@/lib/dto/slate";
import { Slate } from "@/components/screens/Slate";
import { SlateRow } from "./SlateRow";
import {
  DispositionChip,
  EdgeValue,
  PriceValue,
  ProbabilityValue,
} from "./values";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const row = (overrides: Partial<SlateRowDto> = {}): SlateRowDto => ({
  contractId: "c1",
  playerName: "Ja'Marr Chase",
  gameLabel: "CIN @ BAL",
  statType: "receiving_yards",
  threshold: 74.5,
  kickoffAt: "2026-11-08T18:00:00.000Z",
  modelProbability: 0.614,
  confidence: "high",
  projectionComputedAt: "2026-11-05T14:12:00.000Z",
  informationCutoff: "2026-11-05T14:00:00.000Z",
  staleness: {
    isStale: false,
    predatesInactives: false,
    inactivesExpectedAt: null,
  },
  projectionAge: "2d 4h",
  yesBidCents: 52,
  yesAskCents: 54,
  noBidCents: 46,
  noAskCents: 48,
  priceObservedAt: "2026-11-08T16:42:00.000Z",
  priceAge: "0m",
  side: "yes",
  edgePoints: 7.4,
  confidenceAdjustedEdge: 7.4,
  isRecommended: true,
  modelVersion: "baseline-zil-0.1.0",
  projectionState: "projected",
  ...overrides,
});

const slate = (overrides: Partial<SlateDto> = {}): SlateDto => ({
  generatedAt: "2026-11-08T16:42:09.000Z",
  slateDate: "2026-11-08T18:00:00.000Z",
  gameCount: 14,
  rows: [row()],
  unresolved: [],
  lastSync: { status: "complete", finishedAt: "2026-11-08T16:42:09.000Z" },
  degraded: false,
  nextKickoffAt: "2026-11-08T18:00:00.000Z",
  ...overrides,
});

describe("value primitives", () => {
  it("renders a missing value as an em dash, never zero", () => {
    renderThemed(<ProbabilityValue value={null} />);
    expect(screen.getByLabelText("no projection")).toHaveTextContent("—");
  });

  it("carries edge direction with sign and glyph, not colour alone", () => {
    renderThemed(<EdgeValue points={7.4} />);
    expect(screen.getByText(/▲ \+7\.4/)).toBeInTheDocument();
    renderThemed(<EdgeValue points={-3} />);
    expect(screen.getByText(/▼ −3\.0/)).toBeInTheDocument();
  });

  it("formats prices as integer cents", () => {
    renderThemed(<PriceValue cents={54} />);
    expect(screen.getByText("54¢")).toBeInTheDocument();
  });

  it("renders exactly three disposition states", () => {
    for (const disposition of ["took", "faded", "skipped"] as const) {
      const { unmount } = renderThemed(
        <DispositionChip disposition={disposition} />,
      );
      expect(screen.getByText(disposition)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("SlateRow", () => {
  it("marks a recommended row with the chip word, not colour alone", () => {
    renderThemed(<SlateRow row={row()} />);
    expect(screen.getByText(/recommended/)).toBeInTheDocument();
  });

  it("renders a no-projection row with em dashes and the caution chip", () => {
    renderThemed(
      <SlateRow
        row={row({
          modelProbability: null,
          confidence: null,
          side: null,
          edgePoints: null,
          confidenceAdjustedEdge: null,
          isRecommended: false,
          projectionComputedAt: null,
          informationCutoff: null,
          modelVersion: null,
          projectionState: "none",
        })}
      />,
    );
    expect(screen.getByText("no projection")).toBeInTheDocument();
    expect(screen.getByLabelText("no projection")).toHaveTextContent("—");
  });

  it("shows the neutral SIM/BASE provenance chip, never the raw version string", () => {
    const { unmount } = renderThemed(
      <SlateRow row={row({ modelVersion: "simulation-mc-0.1.0" })} />,
    );
    expect(screen.getByText("SIM")).toBeInTheDocument();
    expect(screen.queryByText("simulation-mc-0.1.0")).not.toBeInTheDocument();
    unmount();

    renderThemed(
      <SlateRow row={row({ modelVersion: "baseline-zil-0.1.0" })} />,
    );
    expect(screen.getByText("BASE")).toBeInTheDocument();
    expect(screen.queryByText("baseline-zil-0.1.0")).not.toBeInTheDocument();
  });

  it("renders the insufficient-evidence chip in the probability slot, distinct from no-projection", () => {
    renderThemed(
      <SlateRow
        row={row({
          modelProbability: null,
          confidence: null,
          side: null,
          edgePoints: null,
          isRecommended: false,
          modelVersion: null,
          projectionState: "insufficient_evidence",
        })}
      />,
    );
    expect(screen.getByText("insufficient evidence")).toBeInTheDocument();
    // Distinct from the "no projection" caution chip.
    expect(screen.queryByText("no projection")).not.toBeInTheDocument();
  });

  it("shows a disposition chip only when the payload carries one", () => {
    const { unmount } = renderThemed(<SlateRow row={row()} />);
    expect(screen.queryByText("took")).not.toBeInTheDocument();
    unmount();
    renderThemed(
      <SlateRow
        row={row({
          currentDisposition: "took",
          decidedAt: "2026-11-08T16:44:00Z",
        })}
      />,
    );
    expect(screen.getByText("took")).toBeInTheDocument();
  });

  it("shows both clocks on every row", () => {
    renderThemed(<SlateRow row={row()} />);
    expect(screen.getByText(/^proj/)).toBeInTheDocument();
    expect(screen.getByText(/^price/)).toBeInTheDocument();
  });

  it("appends server-computed ages to both clocks, never merging them", () => {
    renderThemed(<SlateRow row={row()} />);
    expect(screen.getByText(/^proj/)).toHaveTextContent("(2d 4h)");
    expect(screen.getByText(/^price/)).toHaveTextContent("(0m)");
  });

  it("renders the stale chip with its word — caution, list-visible", () => {
    renderThemed(
      <SlateRow
        row={row({
          staleness: {
            isStale: true,
            predatesInactives: false,
            inactivesExpectedAt: null,
          },
        })}
      />,
    );
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.queryByText("predates inactives")).not.toBeInTheDocument();
  });

  it("renders predates-inactives as its own chip; the two states co-occur", () => {
    renderThemed(
      <SlateRow
        row={row({
          staleness: {
            isStale: true,
            predatesInactives: true,
            inactivesExpectedAt: "2026-11-08T16:30:00.000Z",
          },
        })}
      />,
    );
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText("predates inactives")).toBeInTheDocument();
  });

  it("a no-projection row carries neither staleness chip", () => {
    renderThemed(
      <SlateRow
        row={row({
          modelProbability: null,
          confidence: null,
          side: null,
          edgePoints: null,
          confidenceAdjustedEdge: null,
          isRecommended: false,
          projectionComputedAt: null,
          informationCutoff: null,
          staleness: null,
          projectionAge: null,
        })}
      />,
    );
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.queryByText("predates inactives")).not.toBeInTheDocument();
  });
});

describe("Slate screen states", () => {
  it("renders the populated slate with its header facts", () => {
    renderThemed(<Slate slate={slate()} refreshIntervalSeconds={60} />);
    expect(screen.getByText("Slate")).toBeInTheDocument();
    expect(screen.getByText(/14 games/)).toBeInTheDocument();
  });

  it("shows the manual refresh control to an admin only — a diagnostic, not the normal path (Pitch 10)", () => {
    const { rerender } = renderThemed(
      <Slate slate={slate()} refreshIntervalSeconds={60} isAdmin />,
    );
    expect(
      screen.getByRole("button", { name: "Refresh prices" }),
    ).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <Slate slate={slate()} refreshIntervalSeconds={60} isAdmin={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("button", { name: "Refresh prices" })).toBeNull();
  });

  it("no upcoming games is a designed answer with the next kickoff", () => {
    renderThemed(
      <Slate
        slate={slate({ gameCount: 0, rows: [], unresolved: [] })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(screen.getByText("No upcoming games.")).toBeInTheDocument();
    expect(screen.getByText(/Next kickoff/)).toBeInTheDocument();
  });

  it("games with no listed contracts states when Kalshi was last checked", () => {
    renderThemed(
      <Slate
        slate={slate({ rows: [], unresolved: [] })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(
      screen.getByText(/No Kalshi player-prop contracts are listed yet/),
    ).toBeInTheDocument();
  });

  it("nothing above threshold is quiet text, not a warning", () => {
    renderThemed(
      <Slate
        slate={slate({ rows: [row({ isRecommended: false })] })}
        refreshIntervalSeconds={60}
      />,
    );
    const notice = screen.getByText(
      "No contracts meet the recommendation threshold today.",
    );
    expect(notice).toBeInTheDocument();
    // The row itself stays visible and ranked.
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    // Not rendered inside an alert.
    expect(notice.closest('[role="alert"]')).toBeNull();
  });

  it("kalshi degraded renders ONE banner and keeps projections visible", () => {
    renderThemed(
      <Slate
        slate={slate({
          degraded: true,
          lastSync: { status: "failed", finishedAt: "2026-11-08T16:38:00Z" },
        })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(screen.getByText(/Kalshi is unreachable/)).toBeInTheDocument();
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("unresolved contracts are retained in their own labelled section", () => {
    renderThemed(
      <Slate
        slate={slate({
          unresolved: [
            {
              contractId: "u1",
              title: "J. Smith-Njigba receiving yards above 74.5",
              kalshiTicker: "KXNFLRECYDS-26FEB08SEANE-JSN-74.5",
              yesAskCents: 50,
              priceObservedAt: "2026-11-08T16:42:00Z",
            },
          ],
        })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(screen.getByText(/Unresolved contracts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("unresolved")).toBeInTheDocument();
    expect(
      screen.getByText(/J\. Smith-Njigba receiving yards above 74\.5/),
    ).toBeInTheDocument();
  });
});
