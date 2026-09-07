import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

const EXECUTE = readCode(
  join(process.cwd(), "src", "lib", "paper", "execute.ts"),
);
const SETTLEMENT = readCode(
  join(process.cwd(), "src", "lib", "paper", "settlement.ts"),
);
const CONTROLS = readCode(
  join(process.cwd(), "src", "lib", "paper", "controls.ts"),
);

/**
 * Structural assertions about the writer.
 *
 * These are properties of the source rather than behaviours of a call, which is
 * exactly what "nothing deletes a position" needs: you cannot test the delete
 * that was never written, and a behavioural test would pass forever while
 * someone added one.
 */

describe("nothing in this feature deletes ledger data", () => {
  const LEDGER_MODELS = [
    "paperPosition",
    "paperFill",
    "paperLedgerEntry",
    "paperBreach",
    "paperCycle",
    "paperCycleCandidate",
    "paperControlEvent",
  ];

  it("issues no delete against any ledger table", () => {
    // Decisions and positions are the data that cannot be reconstructed. A
    // breaker trip, a mode change, and a settlement supersession all had a
    // tempting shortcut through a delete; none of them takes it.
    for (const source of [EXECUTE, SETTLEMENT, CONTROLS]) {
      for (const model of LEDGER_MODELS) {
        expect(source).not.toContain(`${model}.delete`);
        expect(source).not.toContain(`${model}.deleteMany`);
      }
    }
  });

  it("never updates a ledger entry or a fill after writing it", () => {
    // Append-only is what makes the bankroll reconstructible. A supersession
    // writes compensating entries; it does not edit the originals.
    for (const source of [EXECUTE, SETTLEMENT]) {
      expect(source).not.toContain("paperLedgerEntry.update");
      expect(source).not.toContain("paperFill.update");
    }
  });

  it("never edits a risk config version", () => {
    // "Open positions keep the limits they were created under" is only true if
    // a version is never rewritten.
    expect(CONTROLS).not.toContain("paperRiskConfig.update");
    expect(CONTROLS).not.toContain("paperRiskConfig.delete");
  });
});

describe("the cycle writer", () => {
  it("commits everything for one cycle in a single transaction", () => {
    expect(EXECUTE).toContain("prisma.$transaction");
    expect(EXECUTE).toContain("executeInner(input, tx)");
  });

  it("treats a duplicate scheduler delivery as a coalesced no-op", () => {
    // The (campaignId, gameId, invocationId) unique index IS the idempotency
    // mechanism, exactly as with keepalive and outcome ingest.
    expect(EXECUTE).toContain('return { status: "coalesced" }');
    expect(EXECUTE).toContain("isDuplicate(error)");
  });

  it("writes a candidate row for every candidate, whatever the verdict", () => {
    // The audit trail is the product. A cycle that recorded only its fills
    // could not answer why the other four contracts got nothing.
    expect(EXECUTE).toMatch(
      /for \(const candidate of plan\.candidates\)[\s\S]{0,400}paperCycleCandidate\.create/,
    );
  });

  it("records stake and fee as separate ledger entries", () => {
    // Two facts: the position, and the cost of taking it. A review that could
    // not tell them apart could not answer what fees cost the campaign.
    expect(EXECUTE).toContain('kind: "stake_debit"');
    expect(EXECUTE).toContain('kind: "fee_debit"');
  });

  it("accumulates an increment onto the existing position rather than adding a row", () => {
    expect(EXECUTE).toContain(
      "contracts: { increment: candidate.filledContracts }",
    );
    expect(EXECUTE).toContain(
      "intendedStakeCents: { increment: candidate.intendedStakeCents }",
    );
  });

  it("refuses an increment on the opposite side or onto a settled position", () => {
    expect(EXECUTE).toContain(
      "an increment must be on the same side as the position it adds to",
    );
    expect(EXECUTE).toContain("cannot add to a settled position");
  });

  it("opens at most one breach row per condition", () => {
    // The partial unique index permits one active breach per condition; the
    // writer respects it rather than relying on the database to reject a
    // duplicate mid-transaction.
    expect(EXECUTE).toMatch(
      /paperBreach\.findFirst[\s\S]{0,300}if \(existing\) continue;/,
    );
  });

  it("keeps the fills that happened when a breaker tripped mid-cycle", () => {
    // No rollback path exists: the plan's blocked candidates and its fills are
    // written by the same loop, in the same transaction.
    expect(EXECUTE).not.toContain("rollback");
    expect(EXECUTE).not.toMatch(/if \(plan\.outcome === "halted"\)\s*return/);
  });
});

describe("settlement", () => {
  it("settles against Kalshi's settlement, not the official stat line", () => {
    expect(SETTLEMENT).toContain("tx.outcome.findMany");
    expect(SETTLEMENT).not.toContain("playerGameStat");
    expect(SETTLEMENT).not.toContain("projectionGrade");
  });

  it("writes compensating entries on supersession rather than editing", () => {
    expect(SETTLEMENT).toContain("settlement superseded");
    expect(SETTLEMENT).toContain("amountCents: -priorProceeds");
  });

  it("does nothing on an unchanged re-run", () => {
    expect(SETTLEMENT).toContain(
      "if (alreadySettled && position.settlementResult === outcome.result)",
    );
  });

  it("runs the withdrawal ratchet repeatedly, not once", () => {
    expect(SETTLEMENT).toMatch(/for \(;;\)/);
    expect(SETTLEMENT).toContain("withdrawalCents(");
  });

  it("resets the high-water mark after a withdrawal", () => {
    expect(SETTLEMENT).toContain("withdrewCents: excess");
  });

  it("settles regardless of halted or killed state", () => {
    // A safety stop prevents NEW positions; it is not a reason to leave
    // existing ones unresolved.
    expect(SETTLEMENT).not.toContain("killSwitchEngaged");
    expect(SETTLEMENT).not.toContain('resolution: "active"');
  });

  it("force-settles nothing: every settlement comes from a stored outcome", () => {
    expect(SETTLEMENT).toContain("const outcome = outcomeByContract.get(");
    expect(SETTLEMENT).toContain("if (!outcome) continue;");
  });
});

describe("controls", () => {
  it("engages the kill switch without any confirmation gate", () => {
    // Its purpose is to stop first and ask questions later.
    expect(CONTROLS).toContain("export async function engageKillSwitch");
    expect(CONTROLS).not.toMatch(/engageKillSwitch[\s\S]{0,600}confirm/i);
  });

  it("refuses Resume while a halting condition is still breached", () => {
    expect(CONTROLS).toContain("still breached:");
    expect(CONTROLS).toContain("ControlStateError");
  });

  it("refuses a force override while the kill switch is engaged", () => {
    expect(CONTROLS).toContain(
      "the kill switch is engaged; disengage it before resuming",
    );
  });

  it("refuses a force override of a condition that has cleared", () => {
    expect(CONTROLS).toContain("has cleared; use Resume instead");
  });

  it("requires every active condition to be acknowledged", () => {
    expect(CONTROLS).toContain("every active condition must be acknowledged");
  });

  it("records force_overridden, which is terminal", () => {
    expect(CONTROLS).toContain('resolution: "force_overridden"');
    // Nothing anywhere turns a force override back into a cleared breach.
    expect(CONTROLS).not.toMatch(
      /force_overridden[\s\S]{0,200}resolution: "cleared"/,
    );
  });

  it("locks the starting bankroll once a fill exists", () => {
    expect(CONTROLS).toContain(
      "the starting bankroll is locked once the campaign has positions",
    );
    expect(CONTROLS).toContain("tx.paperFill.count()");
  });

  it("refuses to enable autonomy over an active halting condition", () => {
    expect(CONTROLS).toContain(
      "clear or override the active safety condition before enabling autonomy",
    );
  });

  it("never lets a mode raise the probability ceiling", () => {
    // Including custom. Risk mode governs how much to risk on acceptable
    // opportunities, not what counts as acceptable.
    expect(CONTROLS).toContain("probabilityCeiling: PROBABILITY_CEILING");
    expect(CONTROLS).not.toMatch(/probabilityCeiling: input\./);
  });

  it("takes the actor from a parameter, never from a request body", () => {
    expect(CONTROLS).toMatch(/actorUserId: string/);
    expect(CONTROLS).not.toMatch(/input\.(userId|actorUserId|role)/);
  });
});
