import {
  KalshiRateLimitError,
  KalshiUnavailableError,
  getMarketsByTickers,
} from "./client";

/**
 * The settlement read (SIG-51). Fetch is mocked at the boundary: these tests
 * pin the request shape, the paging, and the error vocabulary — the same
 * two-error contract the listing read established, so callers degrade
 * identically whichever read failed.
 */

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

describe("getMarketsByTickers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("asks for nothing when given no tickers", async () => {
    await expect(getMarketsByTickers([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the tickers as one comma-joined query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ cursor: "", markets: [{ ticker: "A" }, { ticker: "B" }] }),
    );

    const markets = await getMarketsByTickers(["A", "B"]);

    expect(markets.map((market) => market.ticker)).toEqual(["A", "B"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as URL | string);
    expect(url.pathname).toMatch(/\/markets$/);
    expect(url.searchParams.get("tickers")).toBe("A,B");
  });

  it("pages requests so the query string stays bounded", async () => {
    const tickers = Array.from({ length: 150 }, (_, i) => `T${i}`);
    fetchMock.mockResolvedValue(jsonResponse({ cursor: "", markets: [] }));

    await getMarketsByTickers(tickers);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(fetchMock.mock.calls[0][0] as URL | string);
    const second = new URL(fetchMock.mock.calls[1][0] as URL | string);
    expect(first.searchParams.get("tickers")?.split(",")).toHaveLength(100);
    expect(second.searchParams.get("tickers")?.split(",")).toHaveLength(50);
  });

  it("keeps the established error vocabulary: 429 is a rate limit", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as unknown as Response);

    await expect(getMarketsByTickers(["A"])).rejects.toBeInstanceOf(
      KalshiRateLimitError,
    );
  });

  it("keeps the established error vocabulary: non-OK is unavailable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
    } as unknown as Response);

    await expect(getMarketsByTickers(["A"])).rejects.toBeInstanceOf(
      KalshiUnavailableError,
    );
  });

  it("sanitizes network failure into unavailable, with no URL in the message", async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError("fetch failed: https://api.example.com/secret"),
    );

    const failure = getMarketsByTickers(["A"]);
    await expect(failure).rejects.toBeInstanceOf(KalshiUnavailableError);
    await failure.catch((error: Error) => {
      expect(error.message).not.toContain("api.example.com");
    });
  });

  it("tolerates a response with no markets array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cursor: "" }));

    await expect(getMarketsByTickers(["A"])).resolves.toEqual([]);
  });
});
