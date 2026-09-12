import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { productionFiles, readCode, sourceFiles } from "@/lib/testing/source";

/**
 * The invariants this pitch brushes against by design.
 *
 * Autonomous paper trading is the first feature in Sightline that acts without
 * a human in the loop, and the pitch restates one boundary a dozen ways:
 * **exactly one component adapts to measured accuracy, and it is Probability
 * Recalibration touching a probability.** The Kelly fraction does not adapt.
 * Caps do not relax on a winning streak. The ceiling does not rise. Breaker
 * thresholds do not self-tune. Risk mode never changes itself.
 *
 * Those are properties of the whole codebase rather than of any one module, so
 * they live here with the other build-failing invariants.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const relative = (file: string) => file.replace(SRC, "").split(sep).join("/");

describe("nothing adapts a stake, a cap, or a threshold to observed P&L", () => {
  it("writes a risk configuration from exactly the two human-create modules", () => {
    // A config version is the only place the Kelly fraction, the caps, and the
    // halt thresholds are set. Both writers are reached only by a human action —
    // never by anything that reads P&L — which is what makes "risk mode never
    // changes itself" structural.
    //
    // - `controls.ts` — the configuration route's append-a-version save (and the
    //   comparison-bot fan-out that keeps the 3 canonical bots apples-to-apples).
    // - `bots.ts` — Paper Bot Lab's create-bot action, which writes a bot's OWN
    //   initial config once, at birth. This is a HUMAN create (the admin choosing
    //   a bot's risk mode), NOT auto-tuning: every number comes from resolveConfig
    //   applied to the chosen mode, never derived from a bankroll, win rate,
    //   drawdown, or replay result. The spirit — no risk parameter derived from
    //   P&L — is fully preserved; only the create surface is new.
    const writers = productionFiles(SRC).filter((file) =>
      /(prisma|tx|client)\.paperRiskConfig\.(create|update|upsert|createMany)/.test(
        readCode(file),
      ),
    );
    expect(writers.map(relative).sort()).toEqual([
      "/lib/paper/bots.ts",
      "/lib/paper/controls.ts",
    ]);
  });

  it("reaches that writer only from the configuration route", () => {
    const callers = productionFiles(SRC).filter(
      (file) =>
        readCode(file).includes("saveConfiguration") &&
        relative(file) !== "/lib/paper/controls.ts",
    );
    expect(callers.map(relative).sort()).toEqual([
      "/app/api/autonomy/configuration/route.ts",
    ]);
  });

  it("never derives a risk parameter from a P&L or performance figure", () => {
    // The shapes an "adaptive risk" change would take, whatever it was called.
    const forbidden = [
      /kellyFraction\s*[*+\-/]?=\s*[^;]*\b(pnl|profit|winRate|drawdown|streak|performance)/i,
      /perGameCapPct\s*[*+\-/]?=\s*[^;]*\b(pnl|profit|winRate|streak)/i,
      /perSlateCapPct\s*[*+\-/]?=\s*[^;]*\b(pnl|profit|winRate|streak)/i,
      /probabilityCeiling\s*[*+\-/]?=\s*[^;]*\b(pnl|profit|winRate|streak|calibration)/i,
      /drawdownHaltPct\s*[*+\-/]?=\s*[^;]*\b(pnl|profit|winRate|streak)/i,
    ];
    for (const file of productionFiles(SRC)) {
      const code = readCode(file);
      for (const pattern of forbidden) {
        expect({ file: relative(file), matched: pattern.test(code) }).toEqual({
          file: relative(file),
          matched: false,
        });
      }
    }
  });

  it("lets no module read a replay result except the review surface", () => {
    // "A superior counterfactual result does not automatically change the
    // active risk mode" — enforced by nothing outside review being able to see
    // one. The replay writer itself is exempt.
    const readers = productionFiles(SRC).filter((file) =>
      /(prisma|tx)\.paperReplay(ModeResult)?\./.test(readCode(file)),
    );
    for (const file of readers) {
      expect(relative(file)).toMatch(/\/(replay|review)/);
    }
  });
});

describe("no path from paper to live exists", () => {
  it("exposes no route that would activate real-money trading", () => {
    const routes = sourceFiles(join(SRC, "app")).map(relative);
    for (const forbidden of [
      "/activate",
      "/go-live",
      "/live-trading",
      "/enable-live",
      "/withdraw",
      "/orders",
    ]) {
      expect(routes.filter((route) => route.includes(forbidden))).toEqual([]);
    }
  });

  it("names no live ledger or live position anywhere in the source", () => {
    for (const file of productionFiles(SRC)) {
      const code = readCode(file);
      for (const token of [
        "livePosition",
        "liveLedger",
        "liveBankroll",
        "LivePosition",
        "LiveLedgerEntry",
      ]) {
        expect({
          file: relative(file),
          token,
          present: code.includes(token),
        }).toEqual({ file: relative(file), token, present: false });
      }
    }
  });

  it("keeps every autonomy mutation route admin-guarded", () => {
    const autonomyRoutes = sourceFiles(join(SRC, "app", "api", "autonomy"));
    expect(autonomyRoutes.length).toBeGreaterThan(0);
    for (const file of autonomyRoutes) {
      const code = readCode(file);
      expect(code).toContain("requireSession()");
      expect(code).toContain('session.user.role !== "admin"');
      expect(code).toContain('dynamic = "force-dynamic"');
    }
  });

  it("reads no user identifier or role from any autonomy request body", () => {
    for (const file of sourceFiles(join(SRC, "app", "api", "autonomy"))) {
      const code = readCode(file);
      expect(code).not.toMatch(/body\.(userId|role)/);
      expect(code).not.toMatch(/parsed\.data\.(userId|role)/);
    }
  });
});

describe("the paper ledger has no live counterpart to be confused with", () => {
  it("marks every autonomy surface as paper in its own module", () => {
    // A permanent label, not a temporary one pending live mode. The nearest
    // structural proxy: no module in the paper tree names an operating-mode
    // switch that a later pitch could flip.
    for (const file of sourceFiles(join(SRC, "lib", "paper"))) {
      const code = readCode(file);
      for (const token of ["operatingMode", "isLiveMode", "tradingMode"]) {
        expect(code).not.toContain(token);
      }
    }
  });
});

describe("the autonomy workflow places no real order", () => {
  const workflow = readFileSync(
    join(ROOT, ".github", "workflows", "pipeline-autonomy.yml"),
    "utf8",
  );

  it("calls only the two paper pipeline routes", () => {
    const calls = [...workflow.matchAll(/\/api\/pipeline\/([a-z-]+)/g)].map(
      (match) => match[1],
    );
    expect([...new Set(calls)].sort()).toEqual([
      "paper-cycle",
      "paper-settlement",
    ]);
  });

  it("uses the scheduler token and no Kalshi credential", () => {
    expect(workflow).toContain("PIPELINE_SCHEDULER_TOKEN");
    expect(workflow).not.toMatch(/KALSHI/);
  });

  it("runs the cycle often enough to reach the ten-minute cutoff", () => {
    // A coarser cadence would routinely leave the last half hour before
    // kickoff unevaluated, which is when the book is most informative.
    expect(workflow).toContain('cron: "*/10 * * * *"');
  });

  it("offsets settlement from outcome ingest so it reads what ingest wrote", () => {
    expect(workflow).toContain('cron: "20 * * * *"');
    const ingest = readFileSync(
      join(ROOT, ".github", "workflows", "pipeline-outcomes.yml"),
      "utf8",
    );
    expect(ingest).toContain('cron: "30 * * * *"');
  });
});
