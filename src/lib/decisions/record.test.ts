import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const recordCode = readCode(
  join(process.cwd(), "src", "lib", "decisions", "record.ts"),
);
const routeCode = readCode(
  join(process.cwd(), "src", "app", "api", "decisions", "route.ts"),
);

describe("recordDecision structure", () => {
  it("uses the composable-transaction pattern from CLAUDE.md", () => {
    expect(recordCode).toMatch(
      /if \(!tx\) \{\s*return prisma\.\$transaction\(\(client\) => recordDecisionInner\(input, client\)\);/,
    );
  });

  it("is append-only: creates rows and never updates or deletes one", () => {
    expect(recordCode).toContain("decision.create");
    expect(recordCode).not.toMatch(/decision\.update/);
    expect(recordCode).not.toMatch(/decision\.delete/);
  });

  it("links a superseding decision to the one it replaces", () => {
    expect(recordCode).toContain("supersedesDecisionId: previous?.id ?? null");
  });

  it("re-recording the current disposition writes nothing", () => {
    expect(recordCode).toMatch(
      /previous\?\.disposition === input\.disposition[\s\S]{0,200}unchanged: true/,
    );
  });

  it("reads every snapshot value server-side, in the same transaction", () => {
    // The snapshot inputs come from tx queries, not from the input object.
    expect(recordCode).toContain("tx.projection.findFirst");
    expect(recordCode).toContain("tx.priceObservation.findFirst");
    // The input type carries exactly contract, disposition, and the session
    // user — there is no field a client-supplied snapshot could ride in on.
    expect(recordCode).toMatch(
      /RecordDecisionInput = \{\s*contractId: string;\s*disposition: Disposition;[\s\S]{0,120}userId: string;\s*\}/,
    );
  });

  it("enforces the kickoff boundary server-side (RD-6)", () => {
    expect(recordCode).toContain("DecisionClosedError");
    expect(recordCode).toMatch(/kickoffAt\.getTime\(\) <= now\.getTime\(\)/);
    expect(recordCode).toMatch(/status !== "scheduled"/);
  });

  it("freezes the decision-trigger recommendation snapshot in-transaction", () => {
    expect(recordCode).toContain("snapshotForDecision(tx,");
  });
});

describe("decisions route structure", () => {
  it("is admin-only, enforced server-side", () => {
    expect(routeCode).toContain("requireAdmin()");
  });

  it("accepts contractId and disposition and NOTHING else", () => {
    expect(routeCode).toMatch(/\.strict\(\)/);
    expect(routeCode).toMatch(/contractId: z\.uuid\(\)/);
    expect(routeCode).toMatch(
      /disposition: z\.enum\(\["took", "faded", "skipped"\]\)/,
    );
  });

  it("takes the user identity from the session, never the body", () => {
    expect(routeCode).toContain("userId: session.user.id");
    expect(routeCode).not.toMatch(/body[\s\S]{0,80}userId/);
  });

  it("maps the kickoff boundary to invalid_state_transition", () => {
    expect(routeCode).toMatch(
      /DecisionClosedError[\s\S]{0,200}invalid_state_transition/,
    );
  });

  it("supersession returns the existing_decision warning, not an error", () => {
    expect(routeCode).toContain('"existing_decision"');
  });

  it("is never statically rendered", () => {
    expect(routeCode).toContain('dynamic = "force-dynamic"');
  });
});
