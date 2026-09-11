/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/theme";
import type {
  FreshnessStateDto,
  GameGroupDto,
  PlayerCardDto,
  PropDto,
  SlateGroupedDto,
  SlateRowDto,
} from "@/lib/dto/slate";
import { Slate } from "@/components/screens/Slate";
import { BestOpportunities } from "./BestOpportunities";
import { FreshnessLabel } from "./FreshnessLabel";
import { GameGroup } from "./GameGroup";
import { PlayerCard } from "./PlayerCard";
import { SlateRow } from "./SlateRow";
import {
  DispositionChip,
  EdgeValue,
  PriceValue,
  ProbabilityValue,
} from "./values";

const refresh = jest.fn();

// A minimal reactive router mock: `replace` updates the search params and
// notifies subscribers so `useSearchParams` re-renders, mirroring the shallow
// URL-driven scope the Slate relies on. This lets a test drive filters through
// the real code path rather than component-local state.
let currentSearch = "";
const listeners = new Set<() => void>();
const replace = jest.fn((url: string) => {
  const q = url.split("?")[1] ?? "";
  currentSearch = q;
  for (const listener of listeners) listener();
});
jest.mock("next/navigation", () => {
  const { useSyncExternalStore } =
    jest.requireActual<typeof import("react")>("react");
  return {
    useRouter: () => ({ refresh, push: jest.fn(), replace }),
    usePathname: () => "/slate",
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => currentSearch,
        () => currentSearch,
      );
      return new URLSearchParams(search);
    },
  };
});

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const fresh = (
  overrides: Partial<FreshnessStateDto> = {},
): FreshnessStateDto => ({
  state: "current",
  projectionComputedAt: "2026-11-05T14:12:00.000Z",
  informationCutoff: "2026-11-05T14:00:00.000Z",
  priceObservedAt: "2026-11-08T16:42:00.000Z",
  ...overrides,
});

const prop = (overrides: Partial<PropDto> = {}): PropDto => ({
  contractId: "c1",
  statType: "receiving_yards",
  threshold: 74.5,
  direction: "above",
  modelProbability: 0.614,
  confidence: "medium",
  bidCents: 52,
  askCents: 74,
  edgePoints: 8.6,
  confidenceAdjustedEdge: 8.6,
  isRecommended: true,
  ...overrides,
});

const card = (overrides: Partial<PlayerCardDto> = {}): PlayerCardDto => ({
  playerId: "p1",
  playerName: "Ja'Marr Chase",
  teamAbbreviation: "CIN",
  opponentAbbreviation: "BAL",
  statTypes: ["receiving_yards"],
  props: [
    prop(),
    prop({
      direction: "below",
      edgePoints: null,
      isRecommended: false,
      contractId: "c1",
    }),
  ],
  bestOpportunity: prop(),
  projectionState: "projected",
  freshness: fresh(),
  adjustment: { kind: null, note: null, suggestionId: null },
  ...overrides,
});

const game = (overrides: Partial<GameGroupDto> = {}): GameGroupDto => ({
  gameId: "g1",
  homeTeam: "BAL",
  awayTeam: "CIN",
  kickoffAt: "2026-11-08T18:00:00.000Z",
  freshness: fresh(),
  players: [card()],
  ...overrides,
});

const grouped = (
  overrides: Partial<SlateGroupedDto> = {},
): SlateGroupedDto => ({
  games: [game()],
  bestOpportunities: [
    {
      playerId: "p1",
      gameId: "g1",
      prop: prop(),
      playerName: "Ja'Marr Chase",
      teamAbbreviation: "CIN",
      kickoffLabel: "2026-11-08T18:00:00.000Z",
    },
  ],
  unresolved: [],
  availableStatTypes: ["receiving_yards"],
  availableGames: [{ gameId: "g1", label: "CIN @ BAL" }],
  pricesUpdatedAt: "2026-11-08T16:42:09.000Z",
  priceDegraded: false,
  pricePartial: false,
  ...overrides,
});

// The flat SlateRow value primitives remain the shared numeric vocabulary.
const row = (overrides: Partial<SlateRowDto> = {}): SlateRowDto => ({
  contractId: "c1",
  playerId: "p1",
  gameId: "g1",
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

// The Slate syncs scope to the URL with history.replaceState (no navigation, no
// refetch), so tests observe that rather than the router mock.
let historyReplace: jest.SpyInstance;

beforeEach(() => {
  refresh.mockClear();
  replace.mockClear();
  currentSearch = "";
  listeners.clear();
  historyReplace = jest
    .spyOn(window.history, "replaceState")
    .mockImplementation(() => {});
});

afterEach(() => {
  historyReplace.mockRestore();
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

describe("FreshnessLabel", () => {
  it("maps each state to its plain-language word (never colour alone)", () => {
    const cases: Array<[FreshnessStateDto["state"], string]> = [
      ["current", "Current"],
      ["updated_recently", "Updated recently"],
      ["new_info_pending", "New info pending"],
      ["stale", "Stale"],
      ["unavailable", "Unavailable"],
    ];
    for (const [state, label] of cases) {
      const { unmount } = renderThemed(
        <FreshnessLabel freshness={fresh({ state })} />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("PlayerCard — collapsed", () => {
  it("shows only the best opportunity when collapsed, no threshold table", () => {
    renderThemed(<PlayerCard card={card()} />);
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    expect(screen.getByText(/Best: Receiving yds ≥ 74\.5/)).toBeInTheDocument();
    expect(screen.getByText("recommended")).toBeInTheDocument();
    // No wall of numbers, no table until expanded.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a below-threshold card visible and de-emphasised, not removed", () => {
    renderThemed(
      <PlayerCard
        card={card({
          bestOpportunity: prop({ isRecommended: false, edgePoints: 2.1 }),
          props: [prop({ isRecommended: false, edgePoints: 2.1 })],
        })}
      />,
    );
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    expect(screen.queryByText("recommended")).toBeNull();
  });

  it("shows the insufficient-evidence chip when the projection declined", () => {
    renderThemed(
      <PlayerCard
        card={card({
          projectionState: "insufficient_evidence",
          bestOpportunity: null,
          props: [],
        })}
      />,
    );
    expect(screen.getByText("insufficient evidence")).toBeInTheDocument();
  });
});

describe("PlayerCard — expanded (local stepping, no refetch)", () => {
  it("expands to a threshold table and steps thresholds from loaded data", async () => {
    const user = userEvent.setup();
    renderThemed(
      <PlayerCard
        card={card({
          props: [
            prop({
              threshold: 49.5,
              modelProbability: 0.842,
              askCents: 88,
              edgePoints: -3.8,
              isRecommended: false,
            }),
            prop({
              threshold: 74.5,
              modelProbability: 0.614,
              askCents: 74,
              edgePoints: 8.6,
              isRecommended: true,
            }),
          ],
          bestOpportunity: prop({ threshold: 74.5 }),
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Ja'Marr Chase/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByText(/≥ 49\.5/)).toBeInTheDocument();
    expect(within(table).getByText(/≥ 74\.5/)).toBeInTheDocument();
    // The best row's rec marker shows in the table; refresh never fired.
    expect(within(table).getByText("rec")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("PlayerCard — adjustment context by role", () => {
  it("shows an accepted note to both roles", () => {
    const { unmount } = renderThemed(
      <PlayerCard
        card={card({
          adjustment: {
            kind: "accepted",
            note: "ESPN lists CIN active",
            suggestionId: "s1",
          },
        })}
      />,
    );
    expect(screen.getAllByText("adjusted").length).toBeGreaterThan(0);
    unmount();
    renderThemed(
      <PlayerCard
        isAdmin
        card={card({
          adjustment: {
            kind: "accepted",
            note: "ESPN lists CIN active",
            suggestionId: "s1",
          },
        })}
      />,
    );
    expect(screen.getAllByText("adjusted").length).toBeGreaterThan(0);
  });

  it("shows the pending accept/decline band to an admin only", async () => {
    const user = userEvent.setup();
    const pending: Partial<PlayerCardDto> = {
      adjustment: {
        kind: "pending",
        note: "BAL CB questionable",
        suggestionId: "s2",
      },
    };

    const { unmount } = renderThemed(
      <PlayerCard isAdmin card={card(pending)} />,
    );
    await user.click(screen.getByRole("button", { name: /Ja'Marr Chase/ }));
    expect(
      screen.getByRole("button", { name: /Review & accept/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    unmount();

    renderThemed(<PlayerCard card={card(pending)} />);
    await user.click(screen.getByRole("button", { name: /Ja'Marr Chase/ }));
    expect(
      screen.queryByRole("button", { name: /Review & accept/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    // The viewer still sees the status word.
    expect(screen.getByText(/BAL CB questionable/)).toBeInTheDocument();
  });

  it("admin accept posts to the existing route and refreshes in place", async () => {
    const user = userEvent.setup();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderThemed(
      <PlayerCard
        isAdmin
        card={card({
          adjustment: {
            kind: "pending",
            note: "BAL CB questionable",
            suggestionId: "s2",
          },
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Ja'Marr Chase/ }));
    await user.click(screen.getByRole("button", { name: /Review & accept/ }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/suggestions/s2/accept",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("Projection updated")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("GameGroup", () => {
  it("shows one player card per game, matchup, freshness and player count", async () => {
    const user = userEvent.setup();
    renderThemed(<GameGroup game={game()} defaultExpanded />);
    expect(screen.getByText("CIN @ BAL")).toBeInTheDocument();
    expect(screen.getByText(/1 player/)).toBeInTheDocument();
    // Freshness appears on both the game header and the player card.
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    // Collapsible: the header toggles aria-expanded.
    const header = screen.getByRole("button", { name: /CIN @ BAL/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });
});

describe("BestOpportunities", () => {
  it("renders the top slice with direction glyph and links to detail", () => {
    renderThemed(<BestOpportunities rows={grouped().bestOpportunities} />);
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    expect(screen.getByText(/Receiving yds ≥ 74\.5/)).toBeInTheDocument();
    expect(screen.getByText("P(≥)")).toBeInTheDocument();
  });

  it("is quiet, not a warning, when nothing clears the threshold", () => {
    renderThemed(<BestOpportunities rows={[]} />);
    const notice = screen.getByText(
      /Nothing clears the recommendation threshold/,
    );
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="alert"]')).toBeNull();
  });
});

describe("Slate screen states (grouped)", () => {
  it("renders the grouped slate with best opportunities and games", () => {
    renderThemed(<Slate slate={grouped()} refreshIntervalSeconds={60} />);
    expect(screen.getByText("Slate")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Best opportunities" }),
    ).toBeInTheDocument();
    expect(screen.getByText("All games")).toBeInTheDocument();
  });

  it("shows the manual refresh control to an admin only", () => {
    const { rerender } = renderThemed(
      <Slate slate={grouped()} refreshIntervalSeconds={60} isAdmin />,
    );
    expect(
      screen.getByRole("button", { name: "Refresh prices" }),
    ).toBeInTheDocument();
    rerender(
      <ThemeProvider theme={theme}>
        <Slate slate={grouped()} refreshIntervalSeconds={60} isAdmin={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("button", { name: "Refresh prices" })).toBeNull();
  });

  it("no upcoming games is a designed empty answer", () => {
    renderThemed(
      <Slate
        slate={grouped({ games: [], bestOpportunities: [], unresolved: [] })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(screen.getByText("No upcoming games.")).toBeInTheDocument();
  });

  it("nothing recommended is quiet text, not a warning", () => {
    renderThemed(
      <Slate
        slate={grouped({ bestOpportunities: [] })}
        refreshIntervalSeconds={60}
      />,
    );
    const notice = screen.getByText(
      /Nothing clears the recommendation threshold/,
    );
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="alert"]')).toBeNull();
    // Games remain browsable below.
    expect(screen.getByText("All games")).toBeInTheDocument();
  });

  it("kalshi degraded renders ONE banner and keeps cards visible", () => {
    renderThemed(
      <Slate
        slate={grouped({
          priceDegraded: true,
          pricesUpdatedAt: "2026-11-08T16:38:00Z",
        })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(screen.getByText(/Prices unavailable/)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("All games")).toBeInTheDocument();
  });

  it("partial sync discloses that some markets show last-observed prices", () => {
    renderThemed(
      <Slate
        slate={grouped({ pricePartial: true })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(
      screen.getByText(/Some markets could not be refreshed/),
    ).toBeInTheDocument();
  });

  it("a full outage takes precedence over partial: only the degraded banner shows", () => {
    renderThemed(
      <Slate
        slate={grouped({ priceDegraded: true, pricePartial: true })}
        refreshIntervalSeconds={60}
      />,
    );
    expect(screen.getByText(/Prices unavailable/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Some markets could not be refreshed/),
    ).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("paginates the games at 10 per page and starts them collapsed", async () => {
    const user = userEvent.setup();
    // 26 games → 3 pages of 10. Assert on the always-visible game header (the
    // player cards sit inside a Collapse that starts closed).
    const manyGames = Array.from({ length: 26 }, (_, i) =>
      game({
        gameId: `g${i}`,
        awayTeam: `AW${String(i + 1).padStart(2, "0")}`,
        homeTeam: `HM${String(i + 1).padStart(2, "0")}`,
        players: [card({ playerId: `p${i}`, playerName: `Player ${i}` })],
      }),
    );
    renderThemed(
      <Slate
        slate={grouped({ games: manyGames })}
        refreshIntervalSeconds={60}
      />,
    );
    await user.click(screen.getByRole("button", { name: "By game" }));
    // Page 1 shows the first 10 game headers, not the 11th.
    expect(screen.getByText("AW01 @ HM01")).toBeInTheDocument();
    expect(screen.queryByText("AW11 @ HM11")).toBeNull();
    // Games start collapsed: no player-card body is rendered.
    expect(screen.queryByText("Player 0")).toBeNull();
    // The 11th game appears only after paging forward.
    await user.click(screen.getByRole("button", { name: "Go to page 2" }));
    expect(await screen.findByText("AW11 @ HM11")).toBeInTheDocument();
  });

  it("toggling to By game re-emphasises the same data without a refetch", async () => {
    const user = userEvent.setup();
    renderThemed(<Slate slate={grouped()} refreshIntervalSeconds={60} />);
    expect(
      screen.getByRole("heading", { name: "Best opportunities" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "By game" }));
    // Best-opportunities block collapses out of the primary structure.
    expect(
      screen.queryByRole("heading", { name: "Best opportunities" }),
    ).toBeNull();
    expect(screen.getByText("All games")).toBeInTheDocument();
  });

  const withUnresolved = () =>
    grouped({
      unresolved: [
        {
          contractId: "u1",
          title: "J. Smith-Njigba receiving yards above 74.5",
          kalshiTicker: "KXNFLRECYDS-26FEB08SEANE-JSN-74.5",
          yesAskCents: 50,
          priceObservedAt: "2026-11-08T16:42:00Z",
        },
      ],
    });

  it("unresolved contracts are retained (admin), collapsed behind a labelled toggle", async () => {
    const user = userEvent.setup();
    renderThemed(
      <Slate slate={withUnresolved()} refreshIntervalSeconds={60} isAdmin />,
    );
    // The header is visible; the diagnostic list is collapsed by default.
    expect(screen.getByText(/Unresolved contracts \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText("unresolved")).toBeNull();
    // Expanding reveals the retained row (never dropped).
    await user.click(
      screen.getByRole("button", { name: /Unresolved contracts/ }),
    );
    expect(await screen.findByText("unresolved")).toBeInTheDocument();
  });

  it("a viewer never sees the unresolved-contracts diagnostic at all", () => {
    renderThemed(
      <Slate
        slate={withUnresolved()}
        refreshIntervalSeconds={60}
        isAdmin={false}
      />,
    );
    expect(screen.queryByText(/Unresolved contracts/)).toBeNull();
    expect(screen.queryByText("unresolved")).toBeNull();
    // The rest of the slate still renders for the viewer.
    expect(
      screen.getByRole("heading", { name: "Best opportunities" }),
    ).toBeInTheDocument();
  });
});

describe("Slate search & filters (SIG-97 — selection over loaded rows)", () => {
  // Two players, both surfaced in the best-opportunities block (which is what
  // the default best view renders), so search can narrow the visible set.
  const twoPlayers = () =>
    grouped({
      games: [
        game({
          players: [
            card({ playerId: "p1", playerName: "Ja'Marr Chase" }),
            card({
              playerId: "p2",
              playerName: "CeeDee Lamb",
              props: [prop({ contractId: "c2" })],
              bestOpportunity: prop({ contractId: "c2" }),
            }),
          ],
        }),
      ],
      bestOpportunities: [
        {
          playerId: "p1",
          gameId: "g1",
          prop: prop(),
          playerName: "Ja'Marr Chase",
          teamAbbreviation: "CIN",
          kickoffLabel: "2026-11-08T18:00:00.000Z",
        },
        {
          playerId: "p2",
          gameId: "g1",
          prop: prop({ contractId: "c2" }),
          playerName: "CeeDee Lamb",
          teamAbbreviation: "DAL",
          kickoffLabel: "2026-11-08T18:00:00.000Z",
        },
      ],
      availableGames: [{ gameId: "g1", label: "CIN @ BAL" }],
    });

  it("search narrows by partial name and updates the URL (shallow, no refetch)", async () => {
    const user = userEvent.setup();
    renderThemed(<Slate slate={twoPlayers()} refreshIntervalSeconds={60} />);
    // Both players present in the default best view.
    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument();
    expect(screen.getByText("CeeDee Lamb")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search players"), "lamb");

    // The scope was written to the URL via history.replaceState — no navigation,
    // no refetch.
    expect(historyReplace).toHaveBeenCalled();
    expect(historyReplace.mock.calls.at(-1)?.[2]).toContain("q=lamb");
    expect(refresh).not.toHaveBeenCalled();
    // Chase drops out of the (best) view; Lamb remains.
    expect(screen.queryByText("Ja'Marr Chase")).toBeNull();
    expect(screen.getByText("CeeDee Lamb")).toBeInTheDocument();
  });

  it("a zero-result search yields the empty state and changes NO probability", async () => {
    const user = userEvent.setup();
    renderThemed(<Slate slate={twoPlayers()} refreshIntervalSeconds={60} />);

    // The probability shown before filtering (both players show 61.4%).
    expect(screen.getAllByText("61.4%").length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Search players"), "no-such-player");

    // Empty state — a clear answer, never an alert.
    expect(screen.getByText("No players match")).toBeInTheDocument();
    // The rows are HIDDEN, not re-valued: no probability renders at all now.
    expect(screen.queryByText("61.4%")).toBeNull();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("Reset all clears filters back to the default best view", async () => {
    const user = userEvent.setup();
    renderThemed(<Slate slate={twoPlayers()} refreshIntervalSeconds={60} />);
    await user.type(screen.getByLabelText("Search players"), "chase");
    expect(screen.queryByText("CeeDee Lamb")).toBeNull();
    // An active chip appears with a Reset all control.
    const reset = screen.getAllByRole("button", { name: "Reset all" })[0];
    await user.click(reset);
    // The last URL write drops q — the scope returned to default.
    expect(historyReplace.mock.calls.at(-1)?.[2]).not.toContain("q=");
    expect(screen.getByText("CeeDee Lamb")).toBeInTheDocument();
  });

  it("deep-linked scope in the URL is honoured on first render", () => {
    currentSearch = "q=lamb";
    renderThemed(<Slate slate={twoPlayers()} refreshIntervalSeconds={60} />);
    expect(screen.getByText("CeeDee Lamb")).toBeInTheDocument();
    expect(screen.queryByText("Ja'Marr Chase")).toBeNull();
  });
});

describe("SlateRow (flat row primitives — retained for the numeric vocabulary)", () => {
  it("marks a recommended row with the chip word, not colour alone", () => {
    renderThemed(<SlateRow row={row()} />);
    expect(screen.getByText(/recommended/)).toBeInTheDocument();
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
  });

  it("renders the insufficient-evidence chip distinct from no-projection", () => {
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
    expect(screen.queryByText("no projection")).not.toBeInTheDocument();
  });
});
