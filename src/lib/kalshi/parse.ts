import type { StatType } from "../../../generated/prisma/enums";
import type { KalshiMarket, ParsedMarket } from "./types";

/**
 * Parsing Kalshi's NFL player-prop markets into Sightline's vocabulary.
 *
 * Everything here is deterministic and reviewable — no fuzzy scoring, no
 * similarity thresholds (pitch no-go: "unreviewable fuzzy name matching").
 * A market this module cannot parse becomes an `unresolved` contract with a
 * note saying exactly which part failed; it is never guessed at and never
 * dropped.
 *
 * The series set below was verified against the live exchange (2026-08-01):
 * these four series carry per-game player markets that map one-to-one onto
 * Sightline stat types. Kalshi's combined-touchdown series (KXNFLTD,
 * KXNFLANYTD, …) do not split rushing from receiving touchdowns, so they map
 * onto no Sightline stat type and are deliberately not discovered (RD-19 in
 * the run log). In-season, re-verify tickers per the runbook before trusting
 * an empty discovery.
 */
export const SERIES_STAT_TYPES: Readonly<Record<string, StatType>> = {
  KXNFLPASSYDS: "passing_yards",
  KXNFLRSHYDS: "rushing_yards",
  KXNFLRECYDS: "receiving_yards",
  KXNFLREC: "receptions",
};

export const NFL_SERIES_TICKERS = Object.keys(SERIES_STAT_TYPES);

/**
 * nflverse team abbreviations (Team.nflverseAbbr) plus the Kalshi spellings
 * that differ. Values are the nflverse form; keys are what an event ticker
 * may contain.
 */
const NFLVERSE_ABBRS = [
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LA",
  "LAC",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WAS",
] as const;

const TEAM_ALIASES: Readonly<Record<string, string>> = {
  LAR: "LA", // Rams
  WSH: "WAS",
  JAC: "JAX",
  OAK: "LV",
  SD: "LAC",
  STL: "LA",
};

const VALID_CODES: ReadonlySet<string> = new Set([
  ...NFLVERSE_ABBRS,
  ...Object.keys(TEAM_ALIASES),
]);

/** Kalshi team code → nflverse abbreviation. */
export function toNflverseAbbr(code: string): string {
  return TEAM_ALIASES[code] ?? code;
}

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

/**
 * Splits an event-ticker tail like `26FEB08SEANE` into a date and the away
 * and home team codes. The team segment concatenates two variable-length
 * codes, so every split where both halves are known codes is tried; anything
 * other than exactly one valid split is a parse failure, not a guess.
 */
export function parseEventTicker(eventTicker: string): {
  gameDate: { year: number; month: number; day: number } | null;
  awayCode: string | null;
  homeCode: string | null;
} {
  const tail = eventTicker.split("-")[1] ?? "";
  const match = tail.match(/^(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$/);
  if (!match) return { gameDate: null, awayCode: null, homeCode: null };

  const [, yy, mon, dd, teams] = match;
  const month = MONTHS[mon];
  const gameDate = month
    ? { year: 2000 + Number(yy), month, day: Number(dd) }
    : null;

  const splits: Array<[string, string]> = [];
  for (let i = 2; i <= teams.length - 2 && i <= 3; i += 1) {
    const away = teams.slice(0, i);
    const home = teams.slice(i);
    if (VALID_CODES.has(away) && VALID_CODES.has(home)) {
      splits.push([away, home]);
    }
  }

  if (splits.length !== 1) return { gameDate, awayCode: null, homeCode: null };
  return { gameDate, awayCode: splits[0][0], homeCode: splits[0][1] };
}

/**
 * Extracts the player's name from a market's display strings.
 *
 * Tried in order, against `yes_sub_title` then `title`:
 *  1. the portion before a colon ("Jaxon Smith-Njigba: 75+ receiving yards");
 *  2. the portion before a threshold ("Jaxon Smith-Njigba 75+").
 *
 * A candidate must look like a person (at least two word-ish tokens, no
 * digits) or it is rejected — better an unresolved contract than a "player"
 * named "Receiving Yards".
 */
export function parsePlayerName(market: KalshiMarket): string | null {
  const candidates = [market.yes_sub_title, market.title].filter(
    (value): value is string => Boolean(value && value.trim()),
  );

  for (const candidate of candidates) {
    const beforeColon = candidate.match(/^([^:]+):\s+/)?.[1];
    const beforeNumber = candidate.match(/^(.+?)\s+\d/)?.[1];
    for (const raw of [beforeColon, beforeNumber]) {
      const name = raw?.trim();
      if (!name) continue;
      if (/\d/.test(name)) continue;
      if (name.split(/\s+/).length < 2) continue;
      return name;
    }
  }
  return null;
}

/**
 * The threshold this market asks about, in the stat's own units, with
 * "P(stat >= threshold)" semantics.
 *
 * `floor_strike` is authoritative when present: Kalshi expresses "75+" as
 * above-74.5, and P(X >= 74.5) is exactly P(X >= 75) for count-valued stats.
 * The text fallback reads "75+" as 75.
 */
export function parseThreshold(market: KalshiMarket): number | null {
  if (
    typeof market.floor_strike === "number" &&
    isFinite(market.floor_strike)
  ) {
    return market.floor_strike;
  }
  for (const candidate of [market.yes_sub_title, market.title]) {
    const text = candidate?.match(/(\d+(?:\.\d+)?)\s*\+/)?.[1];
    if (text) return Number(text);
  }
  return null;
}

/** Full parse of one discovered market. Never throws; nulls are recorded. */
export function parseMarket(
  market: KalshiMarket,
  seriesTicker: string,
): ParsedMarket {
  const { gameDate, awayCode, homeCode } = parseEventTicker(
    market.event_ticker,
  );
  return {
    kalshiTicker: market.ticker,
    kalshiEventTicker: market.event_ticker,
    kalshiSeriesTicker: seriesTicker,
    title: market.title,
    playerName: parsePlayerName(market),
    statType: SERIES_STAT_TYPES[seriesTicker] ?? null,
    threshold: parseThreshold(market),
    gameDate,
    awayCode,
    homeCode,
    closeTime: market.close_time ? new Date(market.close_time) : null,
    marketStatus: market.status,
  };
}

/**
 * Canonical form for person-name comparison: lowercase, diacritics and
 * punctuation stripped, generational suffixes dropped. Exact equality on
 * this form is the ONLY automatic match the resolver performs.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
