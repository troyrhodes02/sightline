import { rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit within a window", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(rateLimit("k", 10, 1000, 0).allowed).toBe(true);
    }
  });

  it("blocks past the limit and reports when to retry", () => {
    for (let i = 0; i < 10; i += 1) rateLimit("k", 10, 60_000, 0);

    const blocked = rateLimit("k", 10, 60_000, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("opens a fresh window once the old one passes", () => {
    for (let i = 0; i < 11; i += 1) rateLimit("k", 10, 1000, 0);
    expect(rateLimit("k", 10, 1000, 1000).allowed).toBe(true);
  });

  it("counts each key separately", () => {
    for (let i = 0; i < 11; i += 1) rateLimit("a", 10, 1000, 0);
    expect(rateLimit("a", 10, 1000, 0).allowed).toBe(false);
    expect(rateLimit("b", 10, 1000, 0).allowed).toBe(true);
  });
});
