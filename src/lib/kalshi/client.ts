import "server-only";

import { createSign, constants as cryptoConstants } from "node:crypto";
import { serverEnv } from "@/env";
import type { KalshiMarket, KalshiMarketsPage } from "./types";

/**
 * Kalshi trade-api v2 client — **market-data reads only.**
 *
 * There is deliberately no method here for orders, portfolio, balance, or
 * fills, and none may be added before Pitch 11 (spec RD-18). The optional key
 * pair raises the market-data rate-limit tier; it is never logged and never
 * appears in an error. All calls originate server-side — the browser talks
 * only to Sightline.
 */

/** Kalshi was unreachable or returned a non-OK, non-429 response. */
export class KalshiUnavailableError extends Error {
  constructor(status?: number) {
    // No URL and no response body in the message: sanitized by construction.
    super(status ? `Kalshi responded ${status}` : "Kalshi unreachable");
    this.name = "KalshiUnavailableError";
  }
}

export class KalshiRateLimitError extends Error {
  constructor() {
    super("Kalshi rate limit reached");
    this.name = "KalshiRateLimitError";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_LIMIT = 200;
/** Hard cap on pages per listing call; a runaway cursor loop is a bug. */
const MAX_PAGES = 25;

/**
 * RSA-PSS request signing per Kalshi's API-key scheme: the signature covers
 * `timestampMs + METHOD + path` (path includes the /trade-api/v2 prefix,
 * excludes the query string), SHA-256, salt length = digest length.
 */
function signedHeaders(method: string, fullPath: string): HeadersInit {
  const env = serverEnv();
  if (!env.KALSHI_API_KEY_ID || !env.KALSHI_PRIVATE_KEY_PEM) return {};

  const timestamp = Date.now().toString();
  const signer = createSign("sha256");
  signer.update(timestamp + method.toUpperCase() + fullPath);
  const signature = signer.sign(
    {
      key: env.KALSHI_PRIVATE_KEY_PEM,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
    },
    "base64",
  );

  return {
    "KALSHI-ACCESS-KEY": env.KALSHI_API_KEY_ID,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function getJson<T>(
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const env = serverEnv();
  const base = new URL(env.KALSHI_API_BASE_URL);
  const url = new URL(base.pathname.replace(/\/$/, "") + path, base.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value !== "") url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...signedHeaders("GET", url.pathname),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Network failure, DNS, timeout. The cause is not propagated: it can
    // embed the target URL, and sync run rows store our message verbatim.
    throw new KalshiUnavailableError();
  }

  if (response.status === 429) throw new KalshiRateLimitError();
  if (!response.ok) throw new KalshiUnavailableError(response.status);

  return (await response.json()) as T;
}

/**
 * Lists every open market for one series, following the page cursor.
 *
 * One series at a time so a failure is attributable: the sync marks the run
 * `partial` and names the series rather than losing the whole slate.
 */
export async function listOpenMarkets(
  seriesTicker: string,
): Promise<KalshiMarket[]> {
  const markets: KalshiMarket[] = [];
  let cursor = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await getJson<KalshiMarketsPage>("/markets", {
      series_ticker: seriesTicker,
      status: "open",
      limit: String(PAGE_LIMIT),
      cursor,
    });
    markets.push(...(data.markets ?? []));
    cursor = data.cursor ?? "";
    if (cursor === "") break;
  }

  return markets;
}

/** Tickers per settlement request — keeps the query string bounded. */
const TICKERS_PER_REQUEST = 100;

/**
 * Reads specific markets by ticker — the settlement read for outcome ingest.
 *
 * Still market data only: the response carries the settlement `result`
 * alongside the fields the listing read returns, and nothing here signs
 * anything but a GET. Tickers Kalshi does not return are simply absent from
 * the result — the caller treats absence as "could not report yet", never as
 * a settlement.
 */
export async function getMarketsByTickers(
  tickers: ReadonlyArray<string>,
): Promise<KalshiMarket[]> {
  const markets: KalshiMarket[] = [];

  for (let i = 0; i < tickers.length; i += TICKERS_PER_REQUEST) {
    const batch = tickers.slice(i, i + TICKERS_PER_REQUEST);
    const data = await getJson<KalshiMarketsPage>("/markets", {
      tickers: batch.join(","),
      limit: String(TICKERS_PER_REQUEST),
    });
    markets.push(...(data.markets ?? []));
  }

  return markets;
}
