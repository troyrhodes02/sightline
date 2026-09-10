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
  /**
   * LEGACY prices in integer cents, 1–99. Kalshi migrated the market payload
   * to dollar-denominated fields (`*_dollars` below) and no longer populates
   * these; kept optional for resilience and older fixtures. Readers must
   * prefer the `*_dollars` fields. Absent or 0 when a side has no book.
   */
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  /**
   * CURRENT Kalshi price fields: dollar-denominated strings, e.g. "0.83" for
   * 83¢. A side with no book is "0.0000", the empty string, or absent — each
   * must resolve to a null cent price (never a fabricated 0). These replace
   * the legacy integer-cent fields above.
   */
  yes_bid_dollars?: string | number;
  yes_ask_dollars?: string | number;
  no_bid_dollars?: string | number;
  no_ask_dollars?: string | number;
  /** Numeric strike for scalar-derived binaries ("75+ yards" → 74.5). */
  floor_strike?: number;
  /**
   * Settlement result. Empty string until the market settles; "yes" / "no"
   * for determined markets; "void" for voided ones. Open set upstream — an
   * unrecognised value must degrade to `unavailable`, never to a guess.
   */
  result?: string;
  /**
   * ISO 8601 settlement time. Kalshi's current field is `settlement_ts`
   * (SIG-87); `settled_time` is the legacy name, kept for resilience. Readers
   * must prefer `settlement_ts`.
   */
  settlement_ts?: string;
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

/**
 * `GET /markets/{ticker}/orderbook`. Both arrays are resting **bids** on that
 * side — not offers. Buying YES crosses the `no` array; buying NO crosses the
 * `yes` array.
 *
 * Kalshi migrated to a dollar-denominated fixed-point book (SIG-87):
 * `orderbook_fp.{yes,no}_dollars`, each level a `[priceDollars, size]` pair of
 * strings (e.g. `["0.16", "5324.00"]`). `orderbook.{yes,no}` is the legacy
 * integer-cent shape, kept for resilience. Price parses dollars→cents; size is
 * the resting quantity at that level.
 */
type OrderbookLevel = [number | string, number | string];
export type KalshiOrderbookResponse = {
  orderbook_fp?: {
    yes_dollars?: OrderbookLevel[] | null;
    no_dollars?: OrderbookLevel[] | null;
  } | null;
  orderbook?: {
    yes?: Array<[number, number]> | null;
    no?: Array<[number, number]> | null;
  } | null;
};

/**
 * The executable top of book, already inverted into the prices and sizes a
 * buyer would actually get. Nulls mean "no resting liquidity on the side that
 * would fill this" — never zero, and never an invitation to assume depth.
 */
export type OrderbookTop = {
  yesAskCents: number | null;
  yesAskSizeContracts: number | null;
  noAskCents: number | null;
  noAskSizeContracts: number | null;
};
