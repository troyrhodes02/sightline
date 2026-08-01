import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const captureCode = readCode(
  join(process.cwd(), "src", "lib", "pipeline", "final-snapshot.ts"),
);

/**
 * The capture pass is DB-orchestration; its correctness rests on structural
 * properties the partial unique index and these assertions pin. The
 * probability/edge math it reuses is exhaustively tested where it lives
 * (`probability.test.ts`, `edge.test.ts`).
 */
describe("final pre-kickoff snapshot capture (RD-19)", () => {
  it("captures with the final_pre_kickoff trigger and nothing else", () => {
    expect(captureCode).toContain('trigger: "final_pre_kickoff"');
    expect(captureCode).not.toContain('"appeared"');
    expect(captureCode).not.toContain('"state_changed"');
    expect(captureCode).not.toContain('"decision"');
  });

  it("selects games by their own kickoff inside the configured window", () => {
    expect(captureCode).toContain("FINAL_SNAPSHOT_WINDOW_MINUTES");
    expect(captureCode).toMatch(
      /kickoffAt:\s*\{\s*gt:\s*now,\s*lte:\s*windowEnd\s*\}/,
    );
  });

  it("is idempotent: skips already-captured contracts and tolerates losing the insert race", () => {
    expect(captureCode).toContain(
      'snapshots: { none: { trigger: "final_pre_kickoff" } }',
    );
    expect(captureCode).toContain('error.code === "P2002"');
  });

  it("freezes STORED state — no Kalshi call, no live fetch", () => {
    expect(captureCode).not.toContain("runMarketSync");
    expect(captureCode).not.toContain("listOpenMarkets");
    expect(captureCode).not.toContain("fetch(");
  });

  it("captures only — no grading, no timing cost, no outcome reads", () => {
    expect(captureCode).not.toMatch(/outcome/i);
    expect(captureCode).not.toMatch(/timing/i);
    expect(captureCode).not.toMatch(/grade/i);
  });

  it("reads snapshot values server-side from the database, never from a request", () => {
    expect(captureCode).not.toContain("request");
    expect(captureCode).not.toContain("body");
  });
});
