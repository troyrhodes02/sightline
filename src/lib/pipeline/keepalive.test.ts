import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import { actedAtIsPlausible, keepaliveInputSchema } from "./keepalive";

const keepaliveCode = readCode(
  join(process.cwd(), "src", "lib", "pipeline", "keepalive.ts"),
);

describe("keepaliveInputSchema", () => {
  const valid = {
    invocationId: "16538912345",
    commitSha: "a".repeat(40),
    actedAt: "2026-08-01T08:00:00Z",
  };

  it("accepts a well-formed report", () => {
    expect(keepaliveInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a short (7-char) sha", () => {
    expect(
      keepaliveInputSchema.safeParse({ ...valid, commitSha: "abc1234" })
        .success,
    ).toBe(true);
  });

  it("rejects a non-hex or truncated sha", () => {
    for (const commitSha of ["ABC1234", "xyz", "a".repeat(6), "a".repeat(41)]) {
      expect(
        keepaliveInputSchema.safeParse({ ...valid, commitSha }).success,
      ).toBe(false);
    }
  });

  it("rejects an empty or oversized invocationId", () => {
    expect(
      keepaliveInputSchema.safeParse({ ...valid, invocationId: "" }).success,
    ).toBe(false);
    expect(
      keepaliveInputSchema.safeParse({
        ...valid,
        invocationId: "x".repeat(129),
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO actedAt and unknown keys", () => {
    expect(
      keepaliveInputSchema.safeParse({ ...valid, actedAt: "yesterday" })
        .success,
    ).toBe(false);
    expect(
      keepaliveInputSchema.safeParse({ ...valid, userId: "u-1" }).success,
    ).toBe(false); // strict: a machine report carries no user identifier
  });
});

describe("actedAtIsPlausible", () => {
  const now = new Date("2026-08-01T12:00:00Z");

  it("accepts the past and small clock skew", () => {
    expect(actedAtIsPlausible("2026-08-01T11:00:00Z", now)).toBe(true);
    expect(actedAtIsPlausible("2026-08-01T12:04:00Z", now)).toBe(true);
  });

  it("rejects the future beyond skew", () => {
    expect(actedAtIsPlausible("2026-08-01T12:06:00Z", now)).toBe(false);
  });
});

describe("keepalive recording structure", () => {
  it("upserts on (category, invocationId) — duplicate delivery records once", () => {
    expect(keepaliveCode).toContain("category_invocationId");
    expect(keepaliveCode).toMatch(/update:\s*\{\}/);
  });

  it("is born terminal — a keepalive has no running phase", () => {
    expect(keepaliveCode).toContain('status: "succeeded"');
    expect(keepaliveCode).not.toContain('"running"');
  });

  it("derives nextRequiredBy from the configured interval, not a literal", () => {
    expect(keepaliveCode).toContain("KEEPALIVE_INTERVAL_DAYS");
  });
});
