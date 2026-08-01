import { evaluateStaleness, formatAge, inactivesExpectedAt } from "./staleness";

/**
 * The staleness rules, adversarially (spec § Testing strategy, item 4).
 * These are the states with no visible failure mode — a wrong boolean here
 * renders as a plausible slate — so the boundaries are tested exactly.
 */

const LEAD = 90;
const kickoff = new Date("2026-11-08T18:00:00.000Z"); // Sun 1:00 PM ET
const boundary = new Date("2026-11-08T16:30:00.000Z"); // kickoff − 90m

const base = {
  kickoffAt: kickoff,
  informationCutoff: new Date("2026-11-05T14:00:00.000Z"),
  latestFactKnownAt: null as Date | null,
  now: new Date("2026-11-06T12:00:00.000Z"),
};

describe("evaluateStaleness — stale (clearable, RD-22)", () => {
  it("GIVEN no facts newer than the cutoff THEN the projection is not stale", () => {
    const result = evaluateStaleness(
      { ...base, latestFactKnownAt: new Date("2026-11-05T13:59:00.000Z") },
      LEAD,
    );
    expect(result?.isStale).toBe(false);
  });

  it("GIVEN a fact knownAt equal to the cutoff THEN not stale — later means later", () => {
    const result = evaluateStaleness(
      { ...base, latestFactKnownAt: base.informationCutoff },
      LEAD,
    );
    expect(result?.isStale).toBe(false);
  });

  it("GIVEN an ingested fact newer than the cutoff THEN stale", () => {
    const result = evaluateStaleness(
      { ...base, latestFactKnownAt: new Date("2026-11-05T14:00:00.001Z") },
      LEAD,
    );
    expect(result?.isStale).toBe(true);
  });

  it("stays stale as the clock advances — time alone never clears it", () => {
    const fact = new Date("2026-11-05T14:00:00.001Z");
    const later = evaluateStaleness(
      {
        ...base,
        latestFactKnownAt: fact,
        now: new Date("2026-11-08T15:00:00.000Z"),
      },
      LEAD,
    );
    expect(later?.isStale).toBe(true);
  });

  it("clears only when a recomputed projection's cutoff passes the facts", () => {
    const fact = new Date("2026-11-06T10:00:00.000Z");
    const before = evaluateStaleness(
      { ...base, latestFactKnownAt: fact },
      LEAD,
    );
    expect(before?.isStale).toBe(true);
    const recomputed = evaluateStaleness(
      {
        ...base,
        latestFactKnownAt: fact,
        informationCutoff: new Date("2026-11-06T11:00:00.000Z"),
      },
      LEAD,
    );
    expect(recomputed?.isStale).toBe(false);
  });

  it("GIVEN no projection THEN staleness is null, not 'not stale'", () => {
    expect(
      evaluateStaleness({ ...base, informationCutoff: null }, LEAD),
    ).toBeNull();
  });
});

describe("evaluateStaleness — predates inactives (RD-23)", () => {
  it("is off before the boundary and carries no expected time yet", () => {
    const result = evaluateStaleness(
      { ...base, now: new Date(boundary.getTime() - 1) },
      LEAD,
    );
    expect(result?.predatesInactives).toBe(false);
    expect(result?.inactivesExpectedAt).toBeNull();
  });

  it("turns on at exactly kickoff − 90m, with the absolute expected instant", () => {
    const result = evaluateStaleness({ ...base, now: boundary }, LEAD);
    expect(result?.predatesInactives).toBe(true);
    expect(result?.inactivesExpectedAt).toBe(boundary.toISOString());
  });

  it("a recompute after the boundary does NOT clear it — no source exists to have been incorporated", () => {
    const result = evaluateStaleness(
      {
        ...base,
        informationCutoff: new Date(boundary.getTime() + 10 * 60_000),
        now: new Date(boundary.getTime() + 15 * 60_000),
      },
      LEAD,
    );
    expect(result?.predatesInactives).toBe(true);
  });

  it("follows an updated kickoff at the next evaluation — a flexed game un-crosses", () => {
    const crossed = evaluateStaleness({ ...base, now: boundary }, LEAD);
    expect(crossed?.predatesInactives).toBe(true);
    const flexedLater = evaluateStaleness(
      {
        ...base,
        now: boundary,
        kickoffAt: new Date("2026-11-09T01:20:00.000Z"), // flexed to Sunday night
      },
      LEAD,
    );
    expect(flexedLater?.predatesInactives).toBe(false);
  });

  it("the two states are independent and can co-occur", () => {
    const result = evaluateStaleness(
      {
        ...base,
        latestFactKnownAt: new Date("2026-11-08T16:00:00.000Z"),
        now: new Date("2026-11-08T17:00:00.000Z"),
      },
      LEAD,
    );
    expect(result?.isStale).toBe(true);
    expect(result?.predatesInactives).toBe(true);
  });
});

describe("per-game scoping", () => {
  it("facts for an early game never mark a later game — each row sees only its own game's facts", () => {
    const earlyFact = new Date("2026-11-08T16:00:00.000Z");
    const early = evaluateStaleness(
      { ...base, latestFactKnownAt: earlyFact },
      LEAD,
    );
    // The later game's inputs carry ITS fact recency (none) — scoping is the
    // caller feeding per-game facts, asserted here as the contract.
    const later = evaluateStaleness(
      {
        ...base,
        kickoffAt: new Date("2026-11-09T01:20:00.000Z"),
        latestFactKnownAt: null,
      },
      LEAD,
    );
    expect(early?.isStale).toBe(true);
    expect(later?.isStale).toBe(false);
  });
});

describe("inactivesExpectedAt", () => {
  it("is kickoff minus the configured lead", () => {
    expect(inactivesExpectedAt(kickoff, 90).toISOString()).toBe(
      boundary.toISOString(),
    );
    expect(inactivesExpectedAt(kickoff, 60).toISOString()).toBe(
      "2026-11-08T17:00:00.000Z",
    );
  });
});

describe("formatAge", () => {
  const now = new Date("2026-11-08T16:42:00.000Z");
  const cases: Array<[string, string]> = [
    ["2026-11-08T16:42:00.000Z", "0m"],
    ["2026-11-08T16:04:00.000Z", "38m"],
    ["2026-11-08T15:43:00.000Z", "59m"],
    ["2026-11-08T15:42:00.000Z", "1h"],
    ["2026-11-08T10:42:00.000Z", "6h"],
    ["2026-11-07T17:42:00.000Z", "23h"],
    ["2026-11-07T16:42:00.000Z", "1d"],
    ["2026-11-06T12:42:00.000Z", "2d 4h"],
  ];
  it.each(cases)("renders %s as %s", (iso, expected) => {
    expect(formatAge(iso, now)).toBe(expected);
  });

  it("clock skew from the future reads 0m, never negative", () => {
    expect(formatAge("2026-11-08T16:43:00.000Z", now)).toBe("0m");
  });
});
