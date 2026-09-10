import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * Prop Research routes + read (SIG-98), structural invariants that a behavioural
 * test cannot express: the routes are viewer-accessible (session, not admin),
 * the projection route never takes a threshold (no engine on threshold entry),
 * and the read never lets a price influence a probability (RD-8).
 */

const playersRoute = readCode(
  join(process.cwd(), "src", "app", "api", "research", "players", "route.ts"),
);
const projectionRoute = readCode(
  join(
    process.cwd(),
    "src",
    "app",
    "api",
    "research",
    "projection",
    "route.ts",
  ),
);
const readModule = readCode(
  join(process.cwd(), "src", "lib", "research", "read.ts"),
);

describe("research routes — viewer-accessible, server-guarded", () => {
  it("both routes require a session (shared surface) and are not admin-only", () => {
    expect(playersRoute).toContain("requireSession()");
    expect(projectionRoute).toContain("requireSession()");
    expect(playersRoute).not.toContain("requireAdmin");
    expect(projectionRoute).not.toContain("requireAdmin");
  });

  it("are never statically rendered", () => {
    expect(playersRoute).toContain('dynamic = "force-dynamic"');
    expect(projectionRoute).toContain('dynamic = "force-dynamic"');
  });

  it("the projection route takes no threshold parameter (no engine on threshold entry)", () => {
    // The client recomputes P(>=)/P(<) locally; the server distribution read
    // must not accept or key off a threshold.
    expect(projectionRoute).not.toMatch(/threshold/i);
  });
});

describe("research read — no price feeds a probability (RD-8)", () => {
  it("reads no PriceObservation cent values into the payload", () => {
    // The only contract read resolves the listed-contract LINK (id + threshold);
    // it must never surface a cent value or an edge into Prop Research.
    expect(readModule).not.toMatch(/yesAskCents|noAskCents|askCents|bidCents/);
    expect(readModule).not.toMatch(/edge/i);
    expect(readModule).not.toMatch(/profit/i);
  });

  it("reads the base projection only — no accepted-shadow overlay", () => {
    // Selecting provenance "base" directly, and never calling the shadow
    // resolver that the Slate read uses.
    expect(readModule).toContain('provenance: "base"');
    expect(readModule).not.toContain("acceptedShadowProjectionIds");
    expect(readModule).not.toContain("freshestProjections");
  });
});
