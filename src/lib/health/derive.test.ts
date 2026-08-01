import {
  deriveKeepaliveReadiness,
  deriveSignalState,
  hasUpcomingKickoff,
  isGamedayPriceWindow,
  type SignalInputs,
} from "./derive";

const NOW = new Date("2026-11-08T16:00:00Z"); // a Sunday, mid-slate
const HOUR = 60 * 60_000;
const MINUTE = 60_000;

const BASE: SignalInputs = {
  expected: true,
  latestAttempt: null,
  lastSuccessAt: null,
  lateAfterMs: 26 * HOUR,
  runTimeoutMs: 120 * MINUTE,
  now: NOW,
};

function at(hoursAgo: number): Date {
  return new Date(NOW.getTime() - hoursAgo * HOUR);
}

describe("deriveSignalState — the six states (RD-25)", () => {
  it("reads ok when the last success is inside bounds and the latest attempt succeeded", () => {
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: {
        status: "succeeded",
        startedAt: at(5),
        finishedAt: at(5),
      },
      lastSuccessAt: at(5),
    });
    expect(state).toBe("ok");
  });

  it("reads never_run when expected with no success and no attempt", () => {
    expect(deriveSignalState(BASE)).toBe("never_run");
  });

  it("reads late when the last success is older than the bound", () => {
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: {
        status: "succeeded",
        startedAt: at(27),
        finishedAt: at(27),
      },
      lastSuccessAt: at(27),
    });
    expect(state).toBe("late");
  });

  it("is not late at exactly the bound — strictly past it", () => {
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: {
        status: "succeeded",
        startedAt: at(26),
        finishedAt: at(26),
      },
      lastSuccessAt: at(26),
    });
    expect(state).toBe("ok");
  });

  it("reads running while an attempt is in flight inside the timeout", () => {
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: { status: "running", startedAt: at(1), finishedAt: null },
      lastSuccessAt: at(10),
    });
    expect(state).toBe("running");
  });

  it("reads failed — not running — once an in-flight attempt exceeds the timeout", () => {
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: { status: "running", startedAt: at(3), finishedAt: null },
      lastSuccessAt: at(10),
    });
    expect(state).toBe("failed");
  });

  it("reads failed when the latest attempt failed, even with a success inside bounds", () => {
    // Failed outranks late AND ok: "the last cycle broke" is the actionable fact.
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: { status: "failed", startedAt: at(1), finishedAt: at(1) },
      lastSuccessAt: at(5),
    });
    expect(state).toBe("failed");
  });

  it("reads failed for an incomplete (interrupted) latest attempt", () => {
    const state = deriveSignalState({
      ...BASE,
      latestAttempt: {
        status: "incomplete",
        startedAt: at(4),
        finishedAt: at(3),
      },
      lastSuccessAt: at(5),
    });
    expect(state).toBe("failed");
  });

  it("reads not_expected over everything else — dormant is correct, not broken", () => {
    const state = deriveSignalState({
      ...BASE,
      expected: false,
      latestAttempt: {
        status: "failed",
        startedAt: at(2000),
        finishedAt: at(2000),
      },
      lastSuccessAt: at(3000),
    });
    expect(state).toBe("not_expected");
  });
});

describe("schedule-derived expectedness (RD-Q5 — stored schedule, never dates)", () => {
  const LOOKAHEAD = 7 * 24 * HOUR;

  it("is expected when a kickoff lies inside the lookahead", () => {
    const thursday = new Date(NOW.getTime() + 4 * 24 * HOUR);
    expect(hasUpcomingKickoff([thursday], NOW, LOOKAHEAD)).toBe(true);
  });

  it("is not expected when the only kickoffs are past or beyond the lookahead", () => {
    const lastFebruary = new Date(NOW.getTime() - 200 * 24 * HOUR);
    const nextSeason = new Date(NOW.getTime() + 60 * 24 * HOUR);
    expect(hasUpcomingKickoff([lastFebruary, nextSeason], NOW, LOOKAHEAD)).toBe(
      false,
    );
  });

  it("is not expected with no games at all — the offseason answer", () => {
    expect(hasUpcomingKickoff([], NOW, LOOKAHEAD)).toBe(false);
  });
});

describe("game-day price window (kickoff − 6h through kickoff)", () => {
  const WINDOW = 6 * HOUR;

  it("is game day while a kickoff is within the window", () => {
    const kickoff = new Date(NOW.getTime() + 3 * HOUR);
    expect(isGamedayPriceWindow([kickoff], NOW, WINDOW)).toBe(true);
  });

  it("is not game day before the window opens", () => {
    const kickoff = new Date(NOW.getTime() + 7 * HOUR);
    expect(isGamedayPriceWindow([kickoff], NOW, WINDOW)).toBe(false);
  });

  it("is not game day after the last kickoff — kicked-off games contribute nothing", () => {
    const kickedOff = new Date(NOW.getTime() - 1 * HOUR);
    expect(isGamedayPriceWindow([kickedOff], NOW, WINDOW)).toBe(false);
  });
});

describe("keepalive readiness (RD-Q11)", () => {
  const DAYS = 24 * HOUR;
  const CONFIG = { intervalDays: 60, safetyMarginDays: 10, now: NOW };

  it("is due at last action + interval − safety margin", () => {
    const lastActedAt = new Date(NOW.getTime() - 30 * DAYS);
    const { nextRequiredBy, overdue } = deriveKeepaliveReadiness({
      ...CONFIG,
      lastActedAt,
    });
    expect(nextRequiredBy).toEqual(new Date(lastActedAt.getTime() + 50 * DAYS));
    expect(overdue).toBe(false);
  });

  it("turns overdue at exactly the required-by instant, before GitHub's real cutoff", () => {
    const lastActedAt = new Date(NOW.getTime() - 50 * DAYS);
    expect(deriveKeepaliveReadiness({ ...CONFIG, lastActedAt }).overdue).toBe(
      true,
    );
  });

  it("with no keepalive ever recorded, computes nothing rather than fabricating an anchor", () => {
    const readiness = deriveKeepaliveReadiness({
      ...CONFIG,
      lastActedAt: null,
    });
    expect(readiness.nextRequiredBy).toBeNull();
    expect(readiness.overdue).toBe(false);
  });
});
