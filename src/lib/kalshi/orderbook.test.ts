import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const CLIENT = join(process.cwd(), "src", "lib", "kalshi", "client.ts");

/**
 * `getOrderbookTop` is exercised here through a stubbed `fetch`, because its
 * whole value is the inversion it performs and the inversion is arithmetic
 * rather than plumbing.
 */
async function loadClient() {
  jest.resetModules();
  return import("./client");
}

function stubFetch(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("getOrderbookTop inverts Kalshi's book correctly", () => {
  it("prices a YES buy off the NO bids, not the YES ones", async () => {
    // THE trap. Kalshi returns resting BIDS on each side. Buying YES crosses
    // the NO book: the price paid is 100 - bestNoBid, and the size available is
    // that NO bid's size. Reading the `yes` array as "the yes offers" would
    // take the wrong price AND the wrong size, and both would look plausible.
    stubFetch({
      orderbook: {
        yes: [[52, 300]],
        no: [[46, 12]],
      },
    });
    const { getOrderbookTop } = await loadClient();

    const top = await getOrderbookTop("KXNFL-TEST");

    expect(top).toEqual({
      yesAskCents: 54, // 100 - 46
      yesAskSizeContracts: 12, // the NO bid's size
      noAskCents: 48, // 100 - 52
      noAskSizeContracts: 300, // the YES bid's size
    });
  });

  it("takes the highest resting bid on each side", async () => {
    stubFetch({
      orderbook: {
        yes: [
          [40, 100],
          [52, 9],
          [31, 900],
        ],
        no: [
          [30, 500],
          [46, 12],
        ],
      },
    });
    const { getOrderbookTop } = await loadClient();

    const top = await getOrderbookTop("KXNFL-TEST");

    expect(top?.yesAskCents).toBe(54);
    expect(top?.yesAskSizeContracts).toBe(12);
    expect(top?.noAskCents).toBe(48);
    expect(top?.noAskSizeContracts).toBe(9);
  });

  it("reports a side with no resting liquidity as null, never as zero depth", async () => {
    // Null means "cannot price this", which the planner refuses. Zero would
    // read as a real, empty book — a different and more confident claim.
    stubFetch({ orderbook: { yes: [[52, 300]], no: [] } });
    const { getOrderbookTop } = await loadClient();

    const top = await getOrderbookTop("KXNFL-TEST");

    expect(top?.yesAskCents).toBeNull();
    expect(top?.yesAskSizeContracts).toBeNull();
    expect(top?.noAskCents).toBe(48);
  });

  it("discards a zero-size level rather than counting it as liquidity", async () => {
    stubFetch({
      orderbook: {
        yes: [[52, 0]],
        no: [
          [46, 0],
          [40, 25],
        ],
      },
    });
    const { getOrderbookTop } = await loadClient();

    const top = await getOrderbookTop("KXNFL-TEST");

    // The 46 level has no size, so the executable ask is against the 40 bid.
    expect(top?.yesAskCents).toBe(60);
    expect(top?.yesAskSizeContracts).toBe(25);
    expect(top?.noAskCents).toBeNull();
  });

  it("discards a malformed or out-of-range level", async () => {
    stubFetch({
      orderbook: {
        yes: [
          [0, 50],
          [120, 50],
          [44, 7],
        ],
        no: [["x", 5] as unknown as [number, number], [30, 9]],
      },
    });
    const { getOrderbookTop } = await loadClient();

    const top = await getOrderbookTop("KXNFL-TEST");

    expect(top?.noAskCents).toBe(56); // 100 - 44
    expect(top?.yesAskCents).toBe(70); // 100 - 30
  });

  it("returns null when Kalshi reports no book at all", async () => {
    stubFetch({});
    const { getOrderbookTop } = await loadClient();
    expect(await getOrderbookTop("KXNFL-TEST")).toBeNull();
  });

  it("surfaces a Kalshi outage as the client's own error, sanitized", async () => {
    stubFetch({}, 502);
    const { getOrderbookTop, KalshiUnavailableError } = await loadClient();

    await expect(getOrderbookTop("KXNFL-TEST")).rejects.toBeInstanceOf(
      KalshiUnavailableError,
    );
  });

  it("surfaces a rate limit distinctly", async () => {
    stubFetch({}, 429);
    const { getOrderbookTop, KalshiRateLimitError } = await loadClient();

    await expect(getOrderbookTop("KXNFL-TEST")).rejects.toBeInstanceOf(
      KalshiRateLimitError,
    );
  });

  it("escapes the ticker into the path", async () => {
    stubFetch({ orderbook: { yes: [], no: [] } });
    const { getOrderbookTop } = await loadClient();
    await getOrderbookTop("KX/NFL TEST");

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(url.pathname).toContain("KX%2FNFL%20TEST");
    expect(url.pathname).toContain("/orderbook");
  });
});

describe("the client stays read-only", () => {
  const client = readCode(CLIENT);

  it("gained no write-capable endpoint alongside the orderbook read", () => {
    // The build invariant asserts this too. Restating it beside the new method
    // is the point at which someone would be tempted to add an order path,
    // because "the client already talks to the market" starts to feel true.
    for (const forbidden of [
      "/orders",
      "/portfolio",
      "/balance",
      "/fills",
      "/positions",
    ]) {
      expect(client).not.toContain(forbidden);
    }
  });

  it("signs the orderbook read with the same GET-only helper", () => {
    expect(client).toContain('signedHeaders("GET"');
    expect(client).not.toMatch(/signedHeaders\("(POST|PUT|DELETE|PATCH)"/);
  });

  it("documents the inversion where the method lives", () => {
    // A comment is not a guard, but this inversion is invisible in the code
    // itself — both arrays are pairs of numbers — so the explanation earns its
    // place next to the arithmetic, and its absence is worth catching.
    //
    // Read raw rather than through `readCode`, which strips comments precisely
    // so that structural tests do not trip over documentation. Here the
    // documentation IS the subject.
    expect(readFileSync(CLIENT, "utf8")).toMatch(/resting BIDS/);
  });
});
