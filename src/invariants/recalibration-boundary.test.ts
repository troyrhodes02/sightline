import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { productionFiles, readCode } from "@/lib/testing/source";

/**
 * Prices never feed projections — the recalibration half.
 *
 * Probability Recalibration is the one component in this product that is
 * *supposed* to adapt to measured accuracy, which makes it the one place where
 * reaching for a price to "sanity-check" a correction would feel most
 * reasonable. It would also be fatal: Sightline's primary success metric is
 * whether it is better calibrated than the market, and a correction fitted
 * against market prices cannot answer that question about itself. The product
 * would still produce numbers, and the numbers would look fine.
 *
 * The Python runtime is guarded by `python/tests/test_import_graph.py`. This is
 * the TypeScript counterpart, and it exists because recalibration is
 * necessarily TypeScript-side: it reads live grades the application owns.
 *
 * Asserted from source text and the import graph, not from a behavioural test —
 * a behavioural test proves that today's code does not read a price, while this
 * proves that no code path could.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const RECALIBRATION_DIR = join(SRC, "lib", "paper", "recalibration");

/** Every source file under a directory, recursively. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Local relative imports resolved to absolute paths, one hop. */
function localImports(file: string): string[] {
  const code = readFileSync(file, "utf8");
  const dir = file.slice(0, file.lastIndexOf(sep));
  const specifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const resolved: string[] = [];

  for (const specifier of specifiers) {
    let base: string | null = null;
    if (specifier.startsWith(".")) {
      base = join(dir, specifier);
    } else if (specifier.startsWith("@/")) {
      base = join(SRC, specifier.slice(2));
    }
    if (!base) continue;

    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
    ]) {
      try {
        if (statSync(candidate).isFile()) {
          resolved.push(candidate);
          break;
        }
      } catch {
        // Not this extension; try the next.
      }
    }
  }
  return resolved;
}

/**
 * Everything the recalibration modules can reach, transitively, **within
 * `src/`**.
 *
 * The generated Prisma client is deliberately outside the closure. It names
 * every model in the schema by construction, so including it would make this
 * assertion permanently red and teach the next person to weaken it. What
 * matters is which delegates our own code names — the client is the alphabet,
 * not the sentence.
 */
function transitiveClosure(entryPoints: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !file.startsWith(SRC)) continue;
    seen.add(file);
    for (const next of localImports(file)) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

const recalibrationSources = filesUnder(RECALIBRATION_DIR).filter(
  (file) => !file.endsWith(".test.ts"),
);

describe("Probability Recalibration reads no market-derived data", () => {
  it("has production sources to check", () => {
    // A guard that silently covered zero files would pass forever.
    expect(recalibrationSources.length).toBeGreaterThan(0);
  });

  it("names no price, settlement, recommendation, or decision table", () => {
    // Prisma delegate names and the underlying table names, because a raw
    // query would use the latter.
    const forbidden = [
      "priceObservation",
      "price_observations",
      "recommendationSnapshot",
      "recommendation_snapshots",
      "prisma.outcome",
      "outcomes",
      "prisma.decision",
      "decisions",
      "askCents",
      "bidCents",
      "marketSyncRun",
    ];

    for (const file of transitiveClosure(recalibrationSources)) {
      const code = readCode(file);
      for (const token of forbidden) {
        expect({ file, token, present: code.includes(token) }).toEqual({
          file,
          token,
          present: false,
        });
      }
    }
  });

  it("reads exactly calibrationBin, thresholdGrade, backtestRun, projection, and its own table", () => {
    // The positive half of the assertion. Listing what recalibration MAY read
    // is stronger than listing what it may not: a table added to the schema
    // next year is barred by default rather than by remembering to add it to a
    // blocklist.
    const permitted = new Set([
      "recalibrationFit",
      "calibrationBin",
      "thresholdGrade",
      "backtestRun",
      "projection",
    ]);

    const delegates = new Set<string>();
    for (const file of transitiveClosure(recalibrationSources)) {
      const code = readCode(file);
      for (const match of code.matchAll(/\b(?:prisma|tx)\.([a-zA-Z]+)\./g)) {
        delegates.add(match[1]);
      }
    }

    // `$transaction` is a client method, not a model delegate.
    delegates.delete("$transaction");

    expect([...delegates].sort().filter((d) => !permitted.has(d))).toEqual([]);
  });

  it("is not reachable from any Kalshi module", () => {
    // The reverse direction: the market client must not grow a dependency on
    // the correction either, which would be the same leak drawn backwards.
    const kalshiDir = join(SRC, "lib", "kalshi");
    for (const file of filesUnder(kalshiDir)) {
      expect(readCode(file)).not.toContain("paper/recalibration");
    }
  });
});

describe("the correction is the only component that adapts to measured accuracy", () => {
  it("keeps risk configuration out of every module but the configuration route", () => {
    // The invariant the pitch restates a dozen ways: the Kelly fraction does
    // not adapt, caps do not relax on a winning streak, the ceiling does not
    // rise, breaker thresholds do not self-tune, and risk mode never changes
    // itself. Structurally, that means exactly one module writes a risk config
    // — and it is the one a human posts to.
    const writers = productionFiles(SRC).filter((file) => {
      const code = readCode(file);
      return (
        /(prisma|tx)\.paperRiskConfig\.(create|update|upsert|createMany)/.test(
          code,
        ) || /(prisma|tx)\.paperCampaign\.update/.test(code)
      );
    });

    const permitted = writers.filter((file) => {
      const relative = file.replace(SRC, "").split(sep).join("/");
      return (
        relative.startsWith("/app/api/autonomy/") ||
        relative.startsWith("/lib/paper/execute") ||
        relative.startsWith("/lib/paper/settlement") ||
        relative.startsWith("/lib/paper/controls") ||
        // Paper Bot Lab: create/rename/pause a bot. A bot IS a PaperCampaign, so
        // creating one writes a PaperCampaign (+ its own initial risk config) and
        // renaming/pausing updates it. All are HUMAN admin actions reached only by
        // POST — never adapting a risk parameter to P&L, which is the property
        // this guard protects. The new create surface is sanctioned exactly like
        // the configuration route.
        relative.startsWith("/lib/paper/bots") ||
        // PME-6/D2: the confirmed, admin-only model-selection writes
        // `paperCampaign.update` to reset the newly-active portfolio's
        // readiness clock (`portfolioStartedAt`). It never touches a risk
        // config and never adapts to P&L — it is a human production-config
        // action, sanctioned exactly like the configuration route.
        relative.startsWith("/lib/paper/model-selection")
      );
    });

    // Every writer must be one of the sanctioned mutation paths. Nothing in a
    // planner, a read module, a replay, or a readiness evaluation may write
    // one — that is what "no code path adapts a stake to observed P&L" means
    // when it is enforced rather than asserted.
    expect(writers.sort()).toEqual(permitted.sort());
  });
});
