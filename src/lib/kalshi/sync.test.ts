import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import { booksDiffer, sanitizeErrorMessage, toCents } from "./sync";

const syncCode = readCode(
  join(process.cwd(), "src", "lib", "kalshi", "sync.ts"),
);
const clientCode = readCode(
  join(process.cwd(), "src", "lib", "kalshi", "client.ts"),
);

describe("toCents", () => {
  it("keeps valid 1-99 integer cents", () => {
    expect(toCents(54)).toBe(54);
    expect(toCents(1)).toBe(1);
    expect(toCents(99)).toBe(99);
  });

  it("treats an empty side as absent, not free", () => {
    expect(toCents(0)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents(100)).toBeNull();
    expect(toCents(NaN)).toBeNull();
  });
});

describe("booksDiffer", () => {
  const book = {
    yesBidCents: 52,
    yesAskCents: 54,
    noBidCents: 46,
    noAskCents: 48,
  };

  it("identical books do not differ", () => {
    expect(booksDiffer(book, { ...book })).toBe(false);
  });

  it("any side moving is a difference", () => {
    expect(booksDiffer(book, { ...book, yesAskCents: 55 })).toBe(true);
    expect(booksDiffer(book, { ...book, noBidCents: 45 })).toBe(true);
  });

  it("a side appearing or disappearing is a difference", () => {
    expect(booksDiffer(book, { ...book, yesAskCents: null })).toBe(true);
    expect(
      booksDiffer({ ...book, noAskCents: null }, { ...book, noAskCents: 48 }),
    ).toBe(true);
  });
});

describe("sanitizeErrorMessage", () => {
  it("strips URLs, which can embed query strings and hosts", () => {
    const message = sanitizeErrorMessage(
      new Error("fetch failed for https://api.example.com/x?key=abc"),
    );
    expect(message).not.toContain("api.example.com");
    expect(message).not.toContain("key=abc");
    expect(message).toContain("[url]");
  });

  it("bounds message length", () => {
    expect(
      sanitizeErrorMessage(new Error("x".repeat(9000))).length,
    ).toBeLessThanOrEqual(500);
  });
});

describe("sync structure", () => {
  it("coalesces within the configured window (RD-13)", () => {
    expect(syncCode).toContain("KALSHI_SYNC_MIN_INTERVAL_SECONDS");
    expect(syncCode).toContain("coalesced: true");
  });

  it("creates the run row pessimistically so a crash reads as failure", () => {
    expect(syncCode).toMatch(/status: "failed", startedAt/);
  });

  it("delists only after a COMPLETE discovery, and only governed series", () => {
    const delist = syncCode.slice(syncCode.indexOf("completeDiscovery)"));
    expect(syncCode).toContain("if (completeDiscovery)");
    expect(delist).toContain('status: "delisted"');
    expect(delist).toContain("kalshiSeriesTicker: { in: NFL_SERIES_TICKERS }");
  });

  it("never deletes a contract or an observation", () => {
    expect(syncCode).not.toMatch(/contract\.delete/i);
    expect(syncCode).not.toMatch(/priceObservation\.delete/i);
    expect(syncCode).not.toMatch(/priceObservation\.update\b/i);
  });

  it("re-resolves only unresolved and ambiguous contracts (RD-9)", () => {
    expect(syncCode).toMatch(
      /resolutionStatus === "unresolved"[\s\S]{0,80}resolutionStatus === "ambiguous"/,
    );
  });

  it("writes observations on change or heartbeat, not per refresh (RD-14)", () => {
    expect(syncCode).toContain("PRICE_HEARTBEAT_MINUTES");
    expect(syncCode).toMatch(/!booksDiffer[\s\S]{0,60}!heartbeatElapsed/);
  });
});

describe("kalshi client boundaries (read access only, RD-18)", () => {
  it("wraps no order, portfolio, balance, or fill endpoint", () => {
    for (const forbidden of [
      "/portfolio",
      "/orders",
      "/fills",
      "/balance",
      "/positions",
    ]) {
      expect(clientCode).not.toContain(forbidden);
    }
    expect(clientCode).not.toMatch(/method:\s*["'](POST|PUT|DELETE)/i);
  });

  it("never logs and never rethrows raw upstream detail", () => {
    expect(clientCode).not.toMatch(/console\.(log|error|warn|info)/);
    expect(clientCode).not.toContain("KALSHI_PRIVATE_KEY_PEM!");
  });

  it("signs only when a key pair is configured, and sends no key material", () => {
    expect(clientCode).toMatch(
      /if \(!env\.KALSHI_API_KEY_ID \|\| !env\.KALSHI_PRIVATE_KEY_PEM\) return \{\}/,
    );
    // The private key is used to sign and never placed in a header value.
    expect(clientCode).not.toMatch(
      /KALSHI-ACCESS-\w+":\s*env\.KALSHI_PRIVATE_KEY_PEM/,
    );
  });
});
