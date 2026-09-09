import { join, sep } from "node:path";
import { productionFiles, readCode, sourceFiles } from "@/lib/testing/source";

const SRC = join(process.cwd(), "src");
const relative = (file: string) => file.replace(SRC, "").split(sep).join("/");

const DRY_RUN = readCode(join(SRC, "lib", "paper", "dry-run.ts"));
const REPLAY = readCode(join(SRC, "lib", "paper", "replay.ts"));
const READINESS = readCode(join(SRC, "lib", "paper", "readiness.ts"));
const REVIEW = readCode(join(SRC, "lib", "paper", "review.ts"));
const SETTLEMENT_PIPELINE = readCode(
  join(SRC, "lib", "pipeline", "paper-settlement.ts"),
);
const CYCLE_PIPELINE = readCode(join(SRC, "lib", "pipeline", "paper-cycle.ts"));

/**
 * The three boundaries this pitch is most likely to cross by ordinary
 * engineering instinct rather than by an obviously reckless shortcut.
 *
 * All three are asserted from the source rather than from behaviour, because
 * each is a statement about what the code CANNOT do. A behavioural test proves
 * today's code does not write a position; these prove no path exists that
 * could.
 */

describe("Dry Run writes nothing but its own record", () => {
  it("never calls the ledger writer", () => {
    // `executeCycle` is the only function in the codebase that turns a plan
    // into ledger entries. Dry Run's safety is that it does not call it —
    // not a flag threaded through the writer that could be read backwards.
    expect(DRY_RUN).not.toContain("executeCycle");
    expect(DRY_RUN).not.toContain("settleCampaign");
  });

  it("touches exactly one table with a write", () => {
    const writes = [
      ...DRY_RUN.matchAll(
        /prisma\.(\w+)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/g,
      ),
    ];
    expect(writes.map((match) => `${match[1]}.${match[2]}`)).toEqual([
      "paperDryRun.create",
    ]);
  });

  it("creates no position, fill, ledger entry, breach, or desired exposure", () => {
    for (const model of [
      "paperPosition",
      "paperFill",
      "paperLedgerEntry",
      "paperBreach",
      "paperDesiredExposure",
      "paperCycle",
    ]) {
      expect(DRY_RUN).not.toContain(`${model}.create`);
      expect(DRY_RUN).not.toContain(`${model}.upsert`);
      expect(DRY_RUN).not.toContain(`${model}.update`);
    }
  });

  it("calls the same planner the scheduled cycle calls", () => {
    // Sharing the function is the guarantee. An approximation would defeat the
    // point of Dry Run the first time the two drifted.
    expect(DRY_RUN).toContain("planCycle(");
    const cycle = readCode(join(SRC, "lib", "pipeline", "paper-cycle.ts"));
    expect(cycle).toContain("planCycle(");
  });
});

describe("Replay is fenced off from everything real", () => {
  it("writes only its own two tables", () => {
    const writes = [
      ...REPLAY.matchAll(
        /(?:prisma|tx)\.(\w+)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/g,
      ),
    ];
    expect(new Set(writes.map((match) => `${match[1]}.${match[2]}`))).toEqual(
      new Set(["paperReplay.create", "paperReplayModeResult.create"]),
    );
  });

  it("changes no campaign field, risk config, position, or ledger entry", () => {
    for (const forbidden of [
      "paperCampaign.update",
      "paperRiskConfig.create",
      "paperRiskConfig.update",
      "paperPosition.update",
      "paperPosition.create",
      "paperLedgerEntry.create",
      "paperBreach.create",
      "paperBreach.update",
    ]) {
      expect(REPLAY).not.toContain(forbidden);
    }
  });

  it("recomputes no probability, so a later refit cannot leak backwards", () => {
    // It reuses the stored `correctedProbability` from the candidate rows
    // rather than applying the CURRENT recalibration to a historical raw
    // value, which would be hindsight in the most literal sense.
    expect(REPLAY).toContain("candidate.correctedProbability");
    expect(REPLAY).not.toContain("applyKnots");
    expect(REPLAY).not.toContain("activeRecalibration");
    expect(REPLAY).not.toContain("correctedProbability(");
  });

  it("reuses the recorded top-of-book size rather than a current book", () => {
    expect(REPLAY).toContain("candidate.topOfBookSizeContracts");
    expect(REPLAY).not.toContain("getOrderbookTop");
  });

  it("keeps the mode-independent refusals refused", () => {
    // Staleness, an unreadable book, a probability above the ceiling and no
    // edge after fees are properties of the evidence, not of the risk
    // appetite. A replay that reversed them would be a different model, not a
    // different mode.
    expect(REPLAY).toContain('candidate.verdict === "refused"');
    expect(REPLAY).toContain("PROBABILITY_CEILING");
  });

  it("replays the presets only, never `custom`", () => {
    // Custom is whatever the operator last typed; a stored "custom" result
    // would be uninterpretable a month later when the numbers behind the word
    // had changed.
    expect(REPLAY).toContain(
      'REPLAY_MODES: PresetMode[] = ["conservative", "moderate", "aggressive"]',
    );
  });
});

describe("Readiness reports and cannot act", () => {
  it("exports no mutation", () => {
    const exports = [
      ...READINESS.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g),
    ].map((match) => match[1]);
    expect(exports).toEqual(["readReadiness"]);
  });

  it("writes nothing at all", () => {
    expect(
      READINESS.match(/prisma\.\w+\.(create|update|upsert|delete)/g),
    ).toBeNull();
  });

  it("is imported by no route handler", () => {
    // Passing the gate changes a chip and nothing else. A route that could
    // read readiness is a route that could act on it.
    const routes = sourceFiles(join(SRC, "app")).filter((file) =>
      file.endsWith(`${sep}route.ts`),
    );
    for (const route of routes) {
      expect({
        route: relative(route),
        imports: readCode(route).includes("paper/readiness"),
      }).toEqual({ route: relative(route), imports: false });
    }
  });

  it("holds the two-week requirement to the shared constant, with no override", () => {
    expect(READINESS).toContain("REQUIRED_PAPER_WEEKS");
    // No environment variable, query parameter, or argument shortens it.
    expect(READINESS).not.toMatch(/process\.env/);
    expect(READINESS).not.toMatch(/requiredWeeks\s*[:=]/);
    expect(READINESS).not.toMatch(
      /weeksRequired\s*=\s*(?!REQUIRED_PAPER_WEEKS)/,
    );
  });

  it("never counts an unevaluable criterion as met", () => {
    expect(READINESS).toMatch(/met: false,[\s\S]{0,120}unevaluable: true/);
  });

  it("names no activation, withdrawal, or live-mode identifier", () => {
    for (const forbidden of [
      "activateLive",
      "goLive",
      "enableLive",
      "withdrawReal",
      "realMoney",
    ]) {
      expect(READINESS).not.toContain(forbidden);
    }
  });
});

describe("Review quotes model quality rather than recomputing it", () => {
  it("reads the shared calibration sample", () => {
    // The same source the accuracy surface uses, so the two cannot disagree
    // about the model's score.
    expect(REVIEW).toContain("calibrationSample()");
    expect(REVIEW).not.toContain("thresholdGrade.findMany");
  });

  it("renders a stored resolution verbatim rather than deriving one", () => {
    expect(REVIEW).toContain("resolution: breach.resolution");
    expect(REVIEW).not.toMatch(/resolution:\s*"cleared"/);
  });

  it("counts fill quality in three separate buckets", () => {
    expect(REVIEW).toContain("fillQuality.complete");
    expect(REVIEW).toContain("fillQuality.partial");
    expect(REVIEW).toContain("fillQuality.unfilled");
  });
});

describe("no module outside review and replay reads a replay result", () => {
  it("keeps counterfactuals out of every real figure", () => {
    const readers = productionFiles(SRC).filter((file) =>
      /(prisma|tx)\.paperReplay(ModeResult)?\./.test(readCode(file)),
    );
    expect(readers.map(relative).sort()).toEqual(["/lib/paper/replay.ts"]);
  });
});

describe("the kill switch has exactly one owner", () => {
  it("is never persisted as a breach by the settlement pass", () => {
    // `engageKillSwitch` writes the campaign flag and a control event, and no
    // `PaperBreach` — precisely so that `releaseKillSwitch` has nothing left
    // behind to clear. A scheduled pass that opened an active `kill_switch`
    // row would outlive the release: the flag clears, the row stays, the bot
    // stays halted on a condition the operator already lifted, and recovery
    // needs a Resume for something nobody tripped.
    expect(SETTLEMENT_PIPELINE).toContain("killSwitchEngaged: false");
    expect(SETTLEMENT_PIPELINE).not.toContain(
      "killSwitchEngaged: campaign.killSwitchEngaged",
    );
  });
});

describe("a pipeline run row is always closed out", () => {
  it("finishes the run even when the cycle loop throws", () => {
    // `readHealth` selects the paper-cycle signal by `status: "succeeded"`, so
    // a row stranded in `running` makes the health surface keep reporting the
    // last good run's timestamp while nothing is actually running. That is the
    // exact failure the surface exists to expose, hidden by the surface.
    const finishes = [...CYCLE_PIPELINE.matchAll(/finishRun\(/g)];
    expect(finishes.length).toBeGreaterThanOrEqual(4);
    expect(CYCLE_PIPELINE).toMatch(/finishRun\(\s*runId,\s*"failed"/);
    // And the error is re-thrown, not swallowed: a constraint violation is a
    // bug and belongs in a red Actions run, unlike a Kalshi outage.
    expect(CYCLE_PIPELINE).toContain("throw error;");
  });
});
