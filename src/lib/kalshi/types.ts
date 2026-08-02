import type { StatType } from "../../../generated/prisma/enums";

/**
 * The slice of Kalshi's trade-api v2 market payload Sightline reads.
 *
 * Everything else Kalshi returns is deliberately dropped at the client
 * boundary: the narrower this type, the smaller the surface a Kalshi schema
 * drift can break.
 */
export type KalshiMarket = {
  ticker: string;
  event_ticker: string;
  title: string;
  yes_sub_title?: string;
  status: string; // "active" | "closed" | "settled" | ... (open set upstream)
  close_time?: string; // ISO 8601
  /** Prices in integer cents, 1–99. Absent or 0 when a side has no book. */
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  /** Numeric strike for scalar-derived binaries ("75+ yards" → 74.5). */
  floor_strike?: number;
  /**
   * Settlement result. Empty string until the market settles; "yes" / "no"
   * for determined markets; "void" for voided ones. Open set upstream — an
   * unrecognised value must degrade to `unavailable`, never to a guess.
   */
  result?: string;
  /** ISO 8601 settlement time, when Kalshi supplies one. */
  settled_time?: string;
};

export type KalshiEvent = {
  event_ticker: string;
  series_ticker: string;
  title: string;
  sub_title?: string; // "SEA at NE (Feb 8)"
};

/** A market listing page from `GET /markets`. */
export type KalshiMarketsPage = {
  cursor: string;
  markets: KalshiMarket[];
};

/**
 * What the parser extracts from one market, before identity resolution.
 * Null fields are parse failures, each carried into `resolutionNote` rather
 * than silently dropped.
 */
export type ParsedMarket = {
  kalshiTicker: string;
  kalshiEventTicker: string;
  kalshiSeriesTicker: string;
  title: string;
  playerName: string | null;
  statType: StatType | null;
  threshold: number | null;
  /** From the event ticker date segment, e.g. 26FEB08 → 2026-02-08 (ET). */
  gameDate: { year: number; month: number; day: number } | null;
  /** Kalshi team codes from the event ticker, away then home. */
  awayCode: string | null;
  homeCode: string | null;
  closeTime: Date | null;
  marketStatus: string;
};
