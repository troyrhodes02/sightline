import {
  generateInvitationToken,
  hashInvitationToken,
  hashesMatch,
} from "./tokens";

describe("invitation tokens", () => {
  it("generates 256 bits of entropy, URL-safe", () => {
    const token = generateInvitationToken();
    // base64url of 32 bytes, unpadded.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => generateInvitationToken()),
    );
    expect(tokens.size).toBe(500);
  });

  it("hashes deterministically to hex", () => {
    const token = generateInvitationToken();
    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a hash that does not contain the token", () => {
    // The point of storing a hash: a reader of the table learns nothing usable.
    const token = generateInvitationToken();
    expect(hashInvitationToken(token)).not.toContain(token);
  });

  it("compares hashes without leaking length or content", () => {
    const a = hashInvitationToken("a");
    const b = hashInvitationToken("b");
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, b)).toBe(false);
    expect(hashesMatch(a, "short")).toBe(false);
  });
});
