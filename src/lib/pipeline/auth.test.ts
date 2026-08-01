import { verifyPipelineToken } from "./auth";

const TOKEN = "a".repeat(64);

describe("verifyPipelineToken", () => {
  it("accepts the exact configured token", () => {
    expect(verifyPipelineToken(`Bearer ${TOKEN}`, TOKEN)).toBe("ok");
  });

  it("rejects a mismatched token", () => {
    expect(verifyPipelineToken(`Bearer ${"b".repeat(64)}`, TOKEN)).toBe(
      "unauthorized",
    );
  });

  it("rejects a missing or malformed Authorization header", () => {
    expect(verifyPipelineToken(null, TOKEN)).toBe("unauthorized");
    expect(verifyPipelineToken("", TOKEN)).toBe("unauthorized");
    expect(verifyPipelineToken(TOKEN, TOKEN)).toBe("unauthorized"); // no scheme
    expect(verifyPipelineToken(`Basic ${TOKEN}`, TOKEN)).toBe("unauthorized");
    expect(verifyPipelineToken("Bearer ", TOKEN)).toBe("unauthorized");
  });

  it("rejects prefixes and extensions — equality, not startsWith", () => {
    expect(verifyPipelineToken(`Bearer ${TOKEN.slice(0, 63)}`, TOKEN)).toBe(
      "unauthorized",
    );
    expect(verifyPipelineToken(`Bearer ${TOKEN}x`, TOKEN)).toBe("unauthorized");
  });

  it("reports an unset server token as unconfigured, not unauthorized", () => {
    // The route maps this to 503 — a misconfigured deploy must be loud, and
    // distinguishable from a caller with bad credentials.
    expect(verifyPipelineToken(`Bearer ${TOKEN}`, undefined)).toBe(
      "unconfigured",
    );
  });
});
