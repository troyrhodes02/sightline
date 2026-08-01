import { decidePriceRefreshAction } from "./cadence";

/**
 * The cadence decision table (RD-Q5). The cron fires every 15 minutes
 * year-round; these tests pin what an invocation DOES for each schedule
 * shape — from the stored schedule, never from a calendar.
 */

const NOW = new Date("2026-10-25T15:00:00Z"); // a Sunday, mid-season

function inHours(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

describe("decidePriceRefreshAction", () => {
  it("offseason — no kickoff inside the lookahead — is not_expected", () => {
    expect(
      decidePriceRefreshAction({
        kickoffs: [],
        lastSyncFinishedAt: null,
        now: NOW,
      }),
    ).toBe("not_expected");
    expect(
      decidePriceRefreshAction({
        kickoffs: [inHours(8 * 24)], // next game beyond the 7-day lookahead
        lastSyncFinishedAt: null,
        now: NOW,
      }),
    ).toBe("not_expected");
  });

  it("a kickoff inside the game-day window syncs on every invocation", () => {
    expect(
      decidePriceRefreshAction({
        kickoffs: [inHours(2)],
        lastSyncFinishedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
        now: NOW,
      }),
    ).toBe("sync");
  });

  it("in-week with a fresh sync coalesces instead of calling Kalshi", () => {
    expect(
      decidePriceRefreshAction({
        kickoffs: [inHours(3 * 24)], // Thursday game, three days out
        lastSyncFinishedAt: new Date(NOW.getTime() - 20 * 60 * 1000),
        now: NOW,
      }),
    ).toBe("coalesced");
  });

  it("in-week with the cadence elapsed syncs", () => {
    expect(
      decidePriceRefreshAction({
        kickoffs: [inHours(3 * 24)],
        lastSyncFinishedAt: new Date(NOW.getTime() - 61 * 60 * 1000),
        now: NOW,
      }),
    ).toBe("sync");
  });

  it("in-week with no sync ever syncs", () => {
    expect(
      decidePriceRefreshAction({
        kickoffs: [inHours(3 * 24)],
        lastSyncFinishedAt: null,
        now: NOW,
      }),
    ).toBe("sync");
  });

  it("a game already kicked off does not hold the window open", () => {
    expect(
      decidePriceRefreshAction({
        kickoffs: [inHours(-1), inHours(6 * 24)],
        lastSyncFinishedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
        now: NOW,
      }),
    ).toBe("coalesced");
  });
});
