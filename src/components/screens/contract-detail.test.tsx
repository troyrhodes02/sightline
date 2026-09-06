/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type { ContractDetailDto } from "@/lib/dto/slate";
import { ContractDetail } from "./ContractDetail";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const detail = (
  overrides: Partial<ContractDetailDto> = {},
): ContractDetailDto => ({
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
  projectedValue: 78.3,
  projectedMedian: 76.1,
  intervalLow: 41,
  intervalHigh: 118,
  quantiles: {
    q05: 18,
    q10: 41,
    q25: 58,
    q50: 76.1,
    q75: 95,
    q90: 118,
    q95: 139,
  },
  drivers: [
    "14 eligible prior games; exponentially-weighted form 81.2 receiving yards.",
    "Shrunk 22% toward the WR prior for 2025.",
  ],
  modelVersion: "baseline-zil-0.1.0",
  midCents: 53,
  status: "active",
  ...overrides,
});

describe("ContractDetail — resolved", () => {
  it("shows the comparison headline: probability, ask, edge, confidence", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    expect(screen.getByText("61.4%")).toBeInTheDocument();
    expect(screen.getByText(/model P\(≥ 74\.5\)/)).toBeInTheDocument();
    expect(screen.getByText(/▲ \+7\.4/)).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("renders drivers verbatim, in order", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("14 eligible prior games");
    expect(items[1]).toHaveTextContent("Shrunk 22%");
  });

  it("shows both books with the mid as labelled context", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    expect(screen.getByText("yes bid")).toBeInTheDocument();
    expect(screen.getByText("no ask")).toBeInTheDocument();
    expect(screen.getByText("mid")).toBeInTheDocument();
    expect(
      screen.getByText(/ask drives ranking; mid is context/),
    ).toBeInTheDocument();
  });

  it("shows the Currency block: computed-at with age, cutoff, model version", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    expect(screen.getByText("Currency")).toBeInTheDocument();
    expect(screen.getByText(/\(2d 4h ago\)/)).toBeInTheDocument();
    expect(screen.getByText("information cutoff")).toBeInTheDocument();
    expect(screen.getByText("baseline-zil-0.1.0")).toBeInTheDocument();
  });

  it("a current projection renders no staleness explanation", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    expect(screen.queryByText(/A scheduled recompute/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no inactives source/)).not.toBeInTheDocument();
  });

  it("stale: chip in the header plus the clearing-mechanism sentence", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          staleness: {
            isStale: true,
            predatesInactives: false,
            inactivesExpectedAt: null,
          },
        })}
        isAdmin
        isUnresolved={false}
      />,
    );
    expect(screen.getAllByText("stale").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/A scheduled recompute clears this/),
    ).toBeInTheDocument();
  });

  it("predates inactives: neutral disclosure with the expected instant, not an error", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          staleness: {
            isStale: false,
            predatesInactives: true,
            inactivesExpectedAt: "2026-11-08T16:30:00.000Z",
          },
        })}
        isAdmin
        isUnresolved={false}
      />,
    );
    expect(
      screen.getAllByText(/predates inactives/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Sightline has no inactives source in this version/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries the distribution's text equivalent for screen readers", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    expect(
      screen.getByText(/61\.4% of projected outcomes reach 74\.5/),
    ).toBeInTheDocument();
  });
});

describe("ContractDetail — variants", () => {
  it("no projection: em dashes and an explanation, nothing fabricated", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          modelProbability: null,
          confidence: null,
          side: null,
          edgePoints: null,
          confidenceAdjustedEdge: null,
          isRecommended: false,
          projectedValue: null,
          projectedMedian: null,
          intervalLow: null,
          intervalHigh: null,
          quantiles: null,
          drivers: [],
          modelVersion: null,
          projectionComputedAt: null,
          informationCutoff: null,
          staleness: null,
          projectionAge: null,
        })}
        isAdmin
        isUnresolved={false}
      />,
    );
    expect(
      screen.getByText(/Sightline has no projection for this contract/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("no projection")).toHaveTextContent("—");
    expect(screen.queryByText("Drivers")).not.toBeInTheDocument();
    // The Currency block qualifies a projection; with none, it is absent —
    // and so are both staleness chips.
    expect(screen.queryByText("Currency")).not.toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.queryByText("predates inactives")).not.toBeInTheDocument();
  });

  it("no current market: last-observed language, projection intact", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          yesBidCents: null,
          yesAskCents: null,
          noBidCents: null,
          noAskCents: null,
          midCents: null,
          side: null,
          edgePoints: null,
          confidenceAdjustedEdge: null,
          isRecommended: false,
        })}
        isAdmin
        isUnresolved={false}
      />,
    );
    expect(screen.getByText(/No current market/)).toBeInTheDocument();
    expect(screen.getByText("61.4%")).toBeInTheDocument();
  });

  it("delisted status is visible on deep link", () => {
    renderThemed(
      <ContractDetail
        detail={detail({ status: "delisted" })}
        isAdmin
        isUnresolved={false}
      />,
    );
    expect(screen.getByText("delisted")).toBeInTheDocument();
  });
});

describe("ContractDetail — outcome block", () => {
  const settled = (
    overrides: Partial<NonNullable<ContractDetailDto["outcomeBlock"]>> = {},
  ): NonNullable<ContractDetailDto["outcomeBlock"]> => ({
    officialValue: 87,
    officialCorrectedAt: null,
    settlement: { result: "yes", settledAt: "2026-11-09T06:04:00.000Z" },
    projectionGrade: { status: "graded", hit: true, statedProbability: 0.614 },
    recommendationGrade: "correct",
    sourcesDisagree: false,
    ...overrides,
  });

  it("is absent entirely before the game completes", () => {
    renderThemed(
      <ContractDetail detail={detail()} isAdmin isUnresolved={false} />,
    );
    expect(screen.queryByText("Outcome")).not.toBeInTheDocument();
    expect(screen.queryByText("official result")).not.toBeInTheDocument();
  });

  it("agree: official line neutral, settlement, grade lines with sources named", () => {
    renderThemed(
      <ContractDetail
        detail={detail({ outcomeBlock: settled() })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.getByText("Outcome")).toBeInTheDocument();
    expect(
      screen.getByText(/87 receiving yards \(final\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/settled Sun|settled Mon/)).toBeInTheDocument();
    expect(screen.getByText(/over 74\.5:/)).toBeInTheDocument();
    expect(screen.getByText(/hit ✓/)).toBeInTheDocument();
    expect(screen.getByText(/\(p 61\.4%\)/)).toBeInTheDocument();
    expect(screen.getByText(/correct ✓/)).toBeInTheDocument();
    expect(screen.queryByText("sources disagree")).not.toBeInTheDocument();
  });

  it("disagree: the notice renders with BOTH values preserved", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          outcomeBlock: settled({
            settlement: { result: "no", settledAt: null },
            recommendationGrade: "incorrect",
            sourcesDisagree: true,
          }),
        })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.getByText("sources disagree")).toBeInTheDocument();
    expect(
      screen.getByText(/official 87, market settled no · both retained/),
    ).toBeInTheDocument();
    expect(screen.getByText(/incorrect ✗/)).toBeInTheDocument();
  });

  it("pending: taxonomy chips, never blanks or zeros", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          outcomeBlock: settled({
            officialValue: null,
            settlement: null,
            projectionGrade: null,
            recommendationGrade: "pending",
          }),
        })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.getAllByText("pending").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/hit ✓|miss ✗/)).not.toBeInTheDocument();
  });

  it("voided: its own state on settlement and recommendation", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          outcomeBlock: settled({
            settlement: { result: "voided", settledAt: null },
            recommendationGrade: "voided",
          }),
        })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.getAllByText("voided").length).toBeGreaterThanOrEqual(2);
  });

  it("a missing final snapshot renders its taxonomy chip", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          outcomeBlock: settled({
            recommendationGrade: "missing_final_snapshot",
          }),
        })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.getByText("no final snapshot")).toBeInTheDocument();
  });

  it("shows the correction date beside the official line when one exists", () => {
    renderThemed(
      <ContractDetail
        detail={detail({
          outcomeBlock: settled({
            officialCorrectedAt: "2026-11-11T18:10:00.000Z",
          }),
        })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.getByText(/corrected .* ET/)).toBeInTheDocument();
  });

  it("renders the decision line ONLY when the payload carries it", () => {
    const { unmount } = renderThemed(
      <ContractDetail
        detail={detail({
          outcomeBlock: settled({
            decision: { disposition: "took", outcome: "won" },
          }),
        })}
        isAdmin
        isUnresolved={false}
      />,
    );
    expect(screen.getByText("took")).toBeInTheDocument();
    expect(screen.getByText("won")).toBeInTheDocument();
    unmount();

    // A viewer payload has no decision key — the line does not exist.
    renderThemed(
      <ContractDetail
        detail={detail({ outcomeBlock: settled() })}
        isAdmin={false}
        isUnresolved={false}
      />,
    );
    expect(screen.queryByText("decision")).not.toBeInTheDocument();
    expect(screen.queryByText("won")).not.toBeInTheDocument();
  });
});

describe("ContractDetail — unresolved", () => {
  const unresolved = detail({
    playerName: "J. Smith-Njigba receiving yards above 74.5",
    resolutionNote: 'Kalshi name "J. Smith-Njigba" matched 0 players.',
    kalshiPlayerName: "J. Smith-Njigba",
  });

  it("admin sees the diagnostic and the resolve control", () => {
    renderThemed(
      <ContractDetail
        detail={unresolved}
        isAdmin
        isUnresolved
        resolveCandidates={[{ id: "p1", label: "Jaxon Smith-Njigba (WR)" }]}
      />,
    );
    expect(screen.getByText(/matched 0 players/)).toBeInTheDocument();
    expect(screen.getByLabelText("Resolve to player")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm mapping" }),
    ).toBeInTheDocument();
  });

  it("viewer sees the plain unavailable state — no diagnostics, no control", () => {
    const viewerDetail = detail({
      playerName: "J. Smith-Njigba receiving yards above 74.5",
    });
    renderThemed(
      <ContractDetail detail={viewerDetail} isAdmin={false} isUnresolved />,
    );
    expect(
      screen.getByText(/has not been matched to a player yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/matched 0 players/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm mapping" }),
    ).not.toBeInTheDocument();
  });
});
