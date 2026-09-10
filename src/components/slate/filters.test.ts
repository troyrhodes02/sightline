import type {
  GameGroupDto,
  PlayerCardDto,
  PropDto,
  SlateGroupedDto,
} from "@/lib/dto/slate";
import type { FreshnessStateDto } from "@/lib/dto/slate";
import {
  activeFilterCount,
  applyScope,
  DEFAULT_SCOPE,
  isDefaultSelection,
  normalizeName,
  parseScope,
  scopeToParams,
  type SlateScope,
  teamsFromGames,
  windowKey,
  windowOptionsFromGames,
} from "./filters";

const fresh: FreshnessStateDto = {
  state: "current",
  projectionComputedAt: "2026-11-05T14:12:00.000Z",
  informationCutoff: "2026-11-05T14:00:00.000Z",
  priceObservedAt: "2026-11-08T16:42:00.000Z",
};

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
  props: [prop()],
  bestOpportunity: prop(),
  projectionState: "projected",
  freshness: fresh,
  adjustment: { kind: null, note: null, suggestionId: null },
  ...overrides,
});

const game = (overrides: Partial<GameGroupDto> = {}): GameGroupDto => ({
  gameId: "g1",
  homeTeam: "BAL",
  awayTeam: "CIN",
  kickoffAt: "2026-11-08T18:00:00.000Z",
  freshness: fresh,
  players: [card()],
  ...overrides,
});

const slate = (overrides: Partial<SlateGroupedDto> = {}): SlateGroupedDto => ({
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
  ...overrides,
});

const scope = (overrides: Partial<SlateScope> = {}): SlateScope => ({
  ...DEFAULT_SCOPE,
  ...overrides,
});

describe("scope parsing (lenient — never errors)", () => {
  it("defaults an unknown view/rec/market to the safe value", () => {
    const parsed = parseScope(
      new URLSearchParams("view=nonsense&rec=??&market=??"),
    );
    expect(parsed.view).toBe("best");
    expect(parsed.rec).toBe("all");
    expect(parsed.market).toBe("all");
  });

  it("drops unrecognised multi-select members without erroring", () => {
    const parsed = parseScope(
      new URLSearchParams("stat=receiving_yards,not_a_stat&conf=high,bogus"),
    );
    expect(parsed.stats).toEqual(["receiving_yards"]);
    expect(parsed.confidence).toEqual(["high"]);
  });

  it("round-trips a non-default scope through the URL", () => {
    const s = scope({
      view: "game",
      q: "chase",
      games: ["g1"],
      teams: ["CIN"],
      stats: ["receiving_yards"],
      rec: "recommended",
      confidence: ["medium"],
      market: "has_market",
    });
    const params = scopeToParams(s);
    expect(parseScope(params)).toEqual(s);
  });

  it("omits defaults from the URL so a reset is a clean address", () => {
    expect(scopeToParams(DEFAULT_SCOPE).toString()).toBe("");
  });
});

describe("active-filter accounting", () => {
  it("counts facets but not the search field", () => {
    expect(activeFilterCount(scope({ q: "chase" }))).toBe(0);
    expect(
      activeFilterCount(scope({ stats: ["receiving_yards"], rec: "above" })),
    ).toBe(2);
  });

  it("treats search and view-only as the default selection", () => {
    expect(isDefaultSelection(scope())).toBe(true);
    expect(isDefaultSelection(scope({ view: "game" }))).toBe(true);
    expect(isDefaultSelection(scope({ q: "x" }))).toBe(false);
  });
});

describe("derived options (from data, never hardcoded)", () => {
  it("derives teams and windows from the slate's games", () => {
    const games = [
      game({ gameId: "g1", homeTeam: "BAL", awayTeam: "CIN" }),
      game({
        gameId: "g2",
        homeTeam: "DAL",
        awayTeam: "PHI",
        kickoffAt: "2026-11-08T21:25:00.000Z",
      }),
    ];
    expect(teamsFromGames(games)).toEqual(["BAL", "CIN", "DAL", "PHI"]);
    const windows = windowOptionsFromGames(games);
    expect(windows).toHaveLength(2);
    expect(windows.map((w) => w.value)).toEqual([
      windowKey("2026-11-08T18:00:00.000Z"),
      windowKey("2026-11-08T21:25:00.000Z"),
    ]);
  });
});

describe("diacritic- and case-insensitive name matching", () => {
  it("normalises accents and case", () => {
    expect(normalizeName("José")).toBe("jose");
    expect(normalizeName("JA'MARR")).toBe("ja'marr");
  });
});

describe("applyScope selects rows and NEVER mutates numbers", () => {
  it("narrows by partial, diacritic-insensitive player name", () => {
    const withAccent = slate({
      games: [game({ players: [card({ playerName: "Amón-Ra" })] })],
    });
    const out = applyScope(withAccent, scope({ q: "amon" }));
    expect(out.games).toHaveLength(1);
  });

  it("an over-narrow search empties games and best without an error", () => {
    const out = applyScope(slate(), scope({ q: "no-such-player" }));
    expect(out.games).toHaveLength(0);
    expect(out.bestOpportunities).toHaveLength(0);
  });

  it("filters combine (stat AND recommended AND has_market)", () => {
    const s = slate({
      games: [
        game({
          players: [
            card({
              statTypes: ["receiving_yards", "receptions"],
              props: [
                prop({ statType: "receiving_yards", isRecommended: true }),
                prop({
                  statType: "receptions",
                  isRecommended: false,
                  contractId: null,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const out = applyScope(
      s,
      scope({
        stats: ["receiving_yards"],
        rec: "recommended",
        market: "has_market",
      }),
    );
    expect(out.games[0].players[0].props).toHaveLength(1);
    expect(out.games[0].players[0].props[0].statType).toBe("receiving_yards");
    // The receptions prop is filtered out; no player survives an over-narrow combo.
    const empty = applyScope(
      s,
      scope({ stats: ["receptions"], rec: "recommended" }),
    );
    expect(empty.games).toHaveLength(0);
  });

  it("does NOT alter any probability, price, or edge while filtering", () => {
    const s = slate();
    const before = s.games[0].players[0].props[0];
    const beforeProb = before.modelProbability;
    const beforeEdge = before.edgePoints;
    const out = applyScope(s, scope({ rec: "recommended" }));
    const after = out.games[0].players[0].props[0];
    expect(after.modelProbability).toBe(beforeProb);
    expect(after.edgePoints).toBe(beforeEdge);
    // The same object reference travels through — nothing is recomputed.
    expect(after).toBe(before);
  });

  it("re-selects best from surviving props by the existing ranking key", () => {
    const s = slate({
      games: [
        game({
          players: [
            card({
              props: [
                prop({
                  direction: "above",
                  confidenceAdjustedEdge: 8.6,
                  isRecommended: true,
                }),
                prop({
                  direction: "below",
                  confidenceAdjustedEdge: 2.1,
                  isRecommended: false,
                }),
              ],
              bestOpportunity: prop({ confidenceAdjustedEdge: 8.6 }),
            }),
          ],
        }),
      ],
    });
    // Filtering to "below" leaves only the lower-edge prop; best re-selects it.
    const out = applyScope(s, scope({ rec: "below" }));
    expect(
      out.games[0].players[0].bestOpportunity?.confidenceAdjustedEdge,
    ).toBe(2.1);
  });

  it("filters whole games by game id, team, and window", () => {
    const s = slate({
      games: [
        game({ gameId: "g1", homeTeam: "BAL", awayTeam: "CIN" }),
        game({
          gameId: "g2",
          homeTeam: "DAL",
          awayTeam: "PHI",
          kickoffAt: "2026-11-08T21:25:00.000Z",
          players: [card({ playerId: "p2", playerName: "CeeDee Lamb" })],
        }),
      ],
      bestOpportunities: [],
    });
    expect(
      applyScope(s, scope({ games: ["g2"] })).games.map((g) => g.gameId),
    ).toEqual(["g2"]);
    expect(
      applyScope(s, scope({ teams: ["PHI"] })).games.map((g) => g.gameId),
    ).toEqual(["g2"]);
    expect(
      applyScope(
        s,
        scope({ windows: [windowKey("2026-11-08T18:00:00.000Z")] }),
      ).games.map((g) => g.gameId),
    ).toEqual(["g1"]);
  });

  it("preserves the available-option lists even when the selection empties the surface", () => {
    const out = applyScope(slate(), scope({ q: "no-match" }));
    expect(out.availableStatTypes).toEqual(["receiving_yards"]);
    expect(out.availableGames).toEqual([{ gameId: "g1", label: "CIN @ BAL" }]);
  });
});
