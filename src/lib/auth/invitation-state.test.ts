import {
  resolveInvitationState,
  type InvitationLifecycle,
} from "./invitation-state";

const NOW = new Date("2026-08-10T12:00:00Z");
const FUTURE = new Date("2026-08-17T12:00:00Z");
const PAST = new Date("2026-08-03T12:00:00Z");

function invitation(
  over: Partial<InvitationLifecycle> = {},
): InvitationLifecycle {
  return { acceptedAt: null, revokedAt: null, expiresAt: FUTURE, ...over };
}

describe("resolveInvitationState", () => {
  it("resolves a live invitation as valid", () => {
    expect(resolveInvitationState(invitation(), NOW)).toBe("valid");
  });

  it("treats an unknown token as invalid", () => {
    expect(resolveInvitationState(null, NOW)).toBe("invalid");
  });

  it("resolves an accepted invitation as used", () => {
    expect(resolveInvitationState(invitation({ acceptedAt: PAST }), NOW)).toBe(
      "used",
    );
  });

  it("resolves a lapsed invitation as expired", () => {
    expect(resolveInvitationState(invitation({ expiresAt: PAST }), NOW)).toBe(
      "expired",
    );
  });

  it("resolves a revoked invitation as revoked", () => {
    expect(resolveInvitationState(invitation({ revokedAt: PAST }), NOW)).toBe(
      "revoked",
    );
  });

  // The precedence is the point of this function. Each of these would resolve
  // differently under a naive if-chain in the wrong order.
  it("ranks revocation above expiry", () => {
    // A link the admin deliberately killed must not read as merely lapsed —
    // the two say different things to the person holding it.
    expect(
      resolveInvitationState(
        invitation({ revokedAt: PAST, expiresAt: PAST }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("ranks revocation above acceptance", () => {
    expect(
      resolveInvitationState(
        invitation({ revokedAt: PAST, acceptedAt: PAST }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("ranks acceptance above expiry", () => {
    expect(
      resolveInvitationState(
        invitation({ acceptedAt: PAST, expiresAt: PAST }),
        NOW,
      ),
    ).toBe("used");
  });

  it("expires exactly at the boundary, not after it", () => {
    // A half-open window: `expiresAt` is the first instant it is no longer
    // usable, so an off-by-one here hands out a token for one extra tick.
    expect(resolveInvitationState(invitation({ expiresAt: NOW }), NOW)).toBe(
      "expired",
    );
    expect(
      resolveInvitationState(
        invitation({ expiresAt: new Date(NOW.getTime() + 1) }),
        NOW,
      ),
    ).toBe("valid");
  });
});
