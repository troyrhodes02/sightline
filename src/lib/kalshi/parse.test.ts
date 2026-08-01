import {
  NFL_SERIES_TICKERS,
  SERIES_STAT_TYPES,
  normalizeName,
  parseEventTicker,
  parseMarket,
  parsePlayerName,
  parseThreshold,
  toNflverseAbbr,
} from "./parse";
import type { KalshiMarket } from "./types";

const market = (overrides: Partial<KalshiMarket>): KalshiMarket => ({
  ticker: "KXNFLRECYDS-26FEB08SEANE-JSN-74.5",
  event_ticker: "KXNFLRECYDS-26FEB08SEANE",
  title: "Jaxon Smith-Njigba: 75+ receiving yards",
  status: "active",
  ...overrides,
});

describe("series taxonomy", () => {
  it("maps the four verified per-game player series onto Sightline stat types", () => {
    expect(SERIES_STAT_TYPES).toEqual({
      KXNFLPASSYDS: "passing_yards",
      KXNFLRSHYDS: "rushing_yards",
      KXNFLRECYDS: "receiving_yards",
      KXNFLREC: "receptions",
    });
  });

  it("does not discover combined-touchdown series (no matching stat type, RD-19)", () => {
    for (const ticker of NFL_SERIES_TICKERS) {
      expect(ticker).not.toMatch(/TD/);
    }
  });
});

describe("parseEventTicker", () => {
  it("parses date and splits the away/home team codes", () => {
    expect(parseEventTicker("KXNFLRECYDS-26FEB08SEANE")).toEqual({
      gameDate: { year: 2026, month: 2, day: 8 },
      awayCode: "SEA",
      homeCode: "NE",
    });
  });

  it("splits two-letter/three-letter pairs deterministically", () => {
    expect(parseEventTicker("KXNFLRECYDS-25NOV08CINBAL")).toEqual({
      gameDate: { year: 2025, month: 11, day: 8 },
      awayCode: "CIN",
      homeCode: "BAL",
    });
    expect(parseEventTicker("KXNFLRSHYDS-25NOV08GBKC")).toEqual({
      gameDate: { year: 2025, month: 11, day: 8 },
      awayCode: "GB",
      homeCode: "KC",
    });
  });

  it("maps Kalshi team spellings onto nflverse abbreviations", () => {
    const { awayCode, homeCode } = parseEventTicker(
      "KXNFLRECYDS-25NOV08LARSEA",
    );
    expect(awayCode).toBe("LAR");
    expect(homeCode).toBe("SEA");
    expect(toNflverseAbbr("LAR")).toBe("LA");
    expect(toNflverseAbbr("WSH")).toBe("WAS");
    expect(toNflverseAbbr("CIN")).toBe("CIN");
  });

  it("refuses to guess when the team segment is not exactly one valid split", () => {
    const garbage = parseEventTicker("KXNFLRECYDS-25NOV08XXYYZZ");
    expect(garbage.awayCode).toBeNull();
    expect(garbage.homeCode).toBeNull();
    // The date still parses; the failure is scoped to what actually failed.
    expect(garbage.gameDate).toEqual({ year: 2025, month: 11, day: 8 });
  });

  it("returns nulls for a tail that is not an event ticker at all", () => {
    expect(parseEventTicker("KXNFLRECYDS")).toEqual({
      gameDate: null,
      awayCode: null,
      homeCode: null,
    });
  });
});

describe("parsePlayerName", () => {
  it("takes the portion before a colon", () => {
    expect(parsePlayerName(market({}))).toBe("Jaxon Smith-Njigba");
  });

  it("prefers yes_sub_title over title", () => {
    expect(
      parsePlayerName(
        market({
          yes_sub_title: "Ja'Marr Chase: 75+ receiving yards",
          title: "Cincinnati at Baltimore: Receiving Yards",
        }),
      ),
    ).toBe("Ja'Marr Chase");
  });

  it("falls back to the portion before a threshold", () => {
    expect(
      parsePlayerName(market({ title: "Travis Etienne Jr 55+ rushing yards" })),
    ).toBe("Travis Etienne Jr");
  });

  it("rejects candidates that do not look like a person", () => {
    expect(parsePlayerName(market({ title: "Receiving Yards" }))).toBeNull();
    expect(parsePlayerName(market({ title: "75+ yards" }))).toBeNull();
    expect(parsePlayerName(market({ title: "" }))).toBeNull();
  });
});

describe("parseThreshold", () => {
  it("prefers floor_strike when present", () => {
    expect(parseThreshold(market({ floor_strike: 74.5 }))).toBe(74.5);
  });

  it("reads a text threshold when floor_strike is absent", () => {
    expect(parseThreshold(market({}))).toBe(75);
    expect(
      parseThreshold(market({ title: "Sam LaPorta 4.5+ receptions" })),
    ).toBe(4.5);
  });

  it("returns null rather than inventing one", () => {
    expect(parseThreshold(market({ title: "No numbers here" }))).toBeNull();
  });
});

describe("normalizeName", () => {
  it("strips punctuation, case, and diacritics", () => {
    expect(normalizeName("Ja'Marr Chase")).toBe("ja marr chase");
    expect(normalizeName("Jaxon Smith-Njigba")).toBe("jaxon smith njigba");
    expect(normalizeName("A.J. Brown")).toBe("a j brown");
  });

  it("drops generational suffixes so Kalshi and nflverse spellings meet", () => {
    expect(normalizeName("Travis Etienne Jr")).toBe(
      normalizeName("Travis Etienne Jr."),
    );
    expect(normalizeName("Marvin Harrison Jr.")).toBe(
      normalizeName("Marvin Harrison"),
    );
    expect(normalizeName("Brian Robinson III")).toBe(
      normalizeName("Brian Robinson"),
    );
  });

  it("does not conflate distinct names", () => {
    expect(normalizeName("Josh Allen")).not.toBe(normalizeName("Keenan Allen"));
    expect(normalizeName("Michael Pittman")).not.toBe(
      normalizeName("Michael Thomas"),
    );
  });
});

describe("parseMarket", () => {
  it("parses a complete market end to end", () => {
    const parsed = parseMarket(
      market({ floor_strike: 74.5, close_time: "2026-02-08T23:30:00Z" }),
      "KXNFLRECYDS",
    );
    expect(parsed).toMatchObject({
      kalshiTicker: "KXNFLRECYDS-26FEB08SEANE-JSN-74.5",
      kalshiEventTicker: "KXNFLRECYDS-26FEB08SEANE",
      kalshiSeriesTicker: "KXNFLRECYDS",
      playerName: "Jaxon Smith-Njigba",
      statType: "receiving_yards",
      threshold: 74.5,
      gameDate: { year: 2026, month: 2, day: 8 },
      awayCode: "SEA",
      homeCode: "NE",
    });
    expect(parsed.closeTime?.toISOString()).toBe("2026-02-08T23:30:00.000Z");
  });

  it("never throws on a malformed market — nulls are recorded instead", () => {
    const parsed = parseMarket(
      market({
        ticker: "KXNFLRECYDS-BROKEN",
        event_ticker: "KXNFLRECYDS-BROKEN",
        title: "???",
      }),
      "KXNFLRECYDS",
    );
    expect(parsed.playerName).toBeNull();
    expect(parsed.threshold).toBeNull();
    expect(parsed.gameDate).toBeNull();
    expect(parsed.statType).toBe("receiving_yards");
  });

  it("multiple thresholds for one player-stat-game stay distinct contracts", () => {
    const a = parseMarket(
      market({
        ticker: "KXNFLRECYDS-26FEB08SEANE-JSN-74.5",
        floor_strike: 74.5,
      }),
      "KXNFLRECYDS",
    );
    const b = parseMarket(
      market({
        ticker: "KXNFLRECYDS-26FEB08SEANE-JSN-89.5",
        floor_strike: 89.5,
      }),
      "KXNFLRECYDS",
    );
    expect(a.kalshiTicker).not.toBe(b.kalshiTicker);
    expect(a.threshold).not.toBe(b.threshold);
  });
});
