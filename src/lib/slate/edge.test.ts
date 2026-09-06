import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import { CONFIDENCE_WEIGHTS, compareSlateRows, computeEdge } from "./edge";

const THRESHOLD = 5;

describe("computeEdge", () => {
  it("computes the yes side against the yes ask", () => {
    const result = computeEdge(
      {
        modelProbability: 0.614,
        confidence: "high",
        yesAskCents: 54,
        noAskCents: 48,
      },
      THRESHOLD,
    );
    expect(result.side).toBe("yes");
    expect(result.edgePoints).toBe(7.4);
    expect(result.confidenceAdjustedEdge).toBe(7.4);
    expect(result.isRecommended).toBe(true);
  });

  it("selects the no side when the model disagrees downward — never the yes ask inverted", () => {
    // The inverted-edge trap: P(yes)=0.30 with yes ask 44¢ is NOT a −14 edge
    // on yes; it is P(no)=0.70 against the no ask.
    const result = computeEdge(
      {
        modelProbability: 0.3,
        confidence: "high",
        yesAskCents: 44,
        noAskCents: 62,
      },
      THRESHOLD,
    );
    expect(result.side).toBe("no");
    expect(result.edgePoints).toBe(8);
    expect(result.isRecommended).toBe(true);
  });

  it("weights the sort key by confidence, not the raw edge", () => {
    const low = computeEdge(
      {
        modelProbability: 0.62,
        confidence: "low",
        yesAskCents: 50,
        noAskCents: 50,
      },
      THRESHOLD,
    );
    expect(low.edgePoints).toBe(12);
    expect(low.confidenceAdjustedEdge).toBe(4.8);
    expect(low.isRecommended).toBe(false); // 12 raw points, but low confidence

    const high = computeEdge(
      {
        modelProbability: 0.56,
        confidence: "high",
        yesAskCents: 50,
        noAskCents: 50,
      },
      THRESHOLD,
    );
    expect(high.confidenceAdjustedEdge).toBe(6);
    expect(high.isRecommended).toBe(true); // smaller edge, high confidence outranks
  });

  it("null probability or no ask on either side yields null edge — never zero", () => {
    expect(
      computeEdge(
        {
          modelProbability: null,
          confidence: null,
          yesAskCents: 54,
          noAskCents: 48,
        },
        THRESHOLD,
      ),
    ).toEqual({
      side: null,
      edgePoints: null,
      confidenceAdjustedEdge: null,
      isRecommended: false,
    });

    expect(
      computeEdge(
        {
          modelProbability: 0.6,
          confidence: "high",
          yesAskCents: null,
          noAskCents: null,
        },
        THRESHOLD,
      ).edgePoints,
    ).toBeNull();
  });

  it("uses the one available side when the other has no book", () => {
    const result = computeEdge(
      {
        modelProbability: 0.4,
        confidence: "medium",
        yesAskCents: null,
        noAskCents: 55,
      },
      THRESHOLD,
    );
    expect(result.side).toBe("no");
    expect(result.edgePoints).toBe(5);
  });

  it("weights are the single exported constant", () => {
    expect(CONFIDENCE_WEIGHTS).toEqual({ high: 1.0, medium: 0.7, low: 0.4 });
  });
});

describe("compareSlateRows — deterministic ordering", () => {
  const row = (
    adjusted: number | null,
    edge: number | null,
    kickoff: string,
    ticker: string,
  ) => ({
    confidenceAdjustedEdge: adjusted,
    edgePoints: edge,
    kickoffAt: kickoff,
    kalshiTicker: ticker,
  });

  it("ranks by confidence-adjusted edge descending", () => {
    const rows = [
      row(3, 4, "2026-11-08T18:00:00Z", "B"),
      row(7, 7, "2026-11-08T18:00:00Z", "A"),
    ];
    rows.sort(compareSlateRows);
    expect(rows[0].kalshiTicker).toBe("A");
  });

  it("breaks exact ties by raw edge, then kickoff, then ticker — never unstably", () => {
    const rows = [
      row(5, 5, "2026-11-08T21:25:00Z", "C"),
      row(5, 7, "2026-11-08T21:25:00Z", "B"),
      row(5, 5, "2026-11-08T18:00:00Z", "D"),
      row(5, 5, "2026-11-08T18:00:00Z", "A"),
    ];
    rows.sort(compareSlateRows);
    expect(rows.map((r) => r.kalshiTicker)).toEqual(["B", "A", "D", "C"]);
  });

  it("rows with no computable edge rank after every ranked row", () => {
    const rows = [
      row(null, null, "2026-11-08T18:00:00Z", "A"),
      row(-3, -3, "2026-11-08T21:25:00Z", "B"),
    ];
    rows.sort(compareSlateRows);
    expect(rows[0].kalshiTicker).toBe("B");
  });
});

describe("slate read structure", () => {
  const readSource = readCode(
    join(process.cwd(), "src", "lib", "slate", "read.ts"),
  );

  it("persists snapshots only on RD-4 transitions, inside a transaction", () => {
    expect(readSource).toContain("persistSnapshotTransitions");
    expect(readSource).toContain("$transaction");
    expect(readSource).toMatch(/trigger = "appeared"/);
    expect(readSource).toMatch(/trigger = "state_changed"/);
    // Unchanged state persists nothing.
    expect(readSource).toContain("if (!trigger) continue");
  });

  it("attaches decisions only on the admin branch", () => {
    // The viewer path must not merely hide decisions — it must never query
    // them. One code branch, gated on role, is the structural guarantee.
    const decisionQueries = readSource.match(
      /prisma\.decision\.findMany|prisma\.decision\.findFirst/g,
    );
    expect(decisionQueries?.length).toBe(2); // slate + detail, both admin-gated
    // Three admin branches: slate dispositions, unresolved diagnostics,
    // detail dispositions+diagnostics.
    const adminGates = readSource.match(/if \(role === "admin"\)/g);
    expect(adminGates?.length).toBe(3);
    // Every decision query sits after its admin gate.
    const firstQuery = readSource.indexOf("prisma.decision.findMany");
    const firstGate = readSource.indexOf('if (role === "admin")');
    expect(firstGate).toBeGreaterThan(-1);
    expect(firstQuery).toBeGreaterThan(firstGate);
  });

  it("keeps the shared outcome block structurally decision-free", () => {
    // The outcome block is viewer-reachable; its module must never query the
    // private layer. The admin-only decision line is attached by read.ts
    // INSIDE its existing admin gate, after the shared block is built.
    const blockSource = readCode(
      join(process.cwd(), "src", "lib", "slate", "outcome-block.ts"),
    );
    expect(blockSource).not.toMatch(
      /prisma\s*\.\s*decision|tx\s*\.\s*decision/,
    );

    const lastAdminGate = readSource.lastIndexOf('if (role === "admin")');
    const decisionKey = readSource.indexOf("outcomeBlock.decision");
    expect(decisionKey).toBeGreaterThan(lastAdminGate);
  });

  it("stores no derived state back onto contracts or projections", () => {
    expect(readSource).not.toMatch(/contract\.update/);
    expect(readSource).not.toMatch(/projection\.update/);
  });

  it("keeps below-threshold rows in the response", () => {
    expect(readSource).not.toMatch(/filter\([^)]*isRecommended/);
  });
});
