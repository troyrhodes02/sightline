import { join } from "node:path";
import { readHealthSignals } from "./read";
import { productionFiles, readCode } from "@/lib/testing/source";

describe("health signals", () => {
  it("reports all three scheduled processes", async () => {
    const signals = await readHealthSignals();
    expect(signals.map((s) => s.key)).toEqual([
      "ingest",
      "recompute",
      "price_refresh",
    ]);
  });

  it("reports every signal as not yet implemented in this pitch", async () => {
    const signals = await readHealthSignals();
    for (const signal of signals) {
      expect(signal.state).toBe("not_yet_implemented");
    }
  });

  it("fabricates no timestamp for a job that does not exist", async () => {
    const signals = await readHealthSignals();
    for (const signal of signals) {
      expect(signal.lastSuccessAt).toBeNull();
      expect(signal.lastAttemptAt).toBeNull();
      expect(signal.lastSuccessAge).toBeNull();
    }
  });

  it("carries the fields Pitch 5 populates, so the row need not be redesigned", async () => {
    const [first] = await readHealthSignals();
    expect(first).toHaveProperty("expectedWithin");
    expect(first).toHaveProperty("lastAttemptAt");
  });
});

describe("health does not read ingest_runs", () => {
  // Rows exist there from Pitch 1's manual local backfill. Rendering one as
  // "last successful ingest" would report a scheduled pipeline as healthy when
  // no scheduled pipeline exists.
  it("touches no ingest run anywhere in the health path", () => {
    const health = productionFiles(join(process.cwd(), "src", "lib", "health"));

    for (const file of health) {
      const code = readCode(file);
      expect(code).not.toMatch(/ingestRun|ingest_runs/i);
      expect(code).not.toContain("prisma");
    }
  });
});
