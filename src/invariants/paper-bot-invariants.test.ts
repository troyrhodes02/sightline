import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { productionFiles, readCode, sourceFiles } from "@/lib/testing/source";

/**
 * Paper Bot reorg invariants (PME-6, D7/D10/D12/D13).
 *
 * The pitch's top rabbit hole is a computed value writing production config. The
 * only path that may write `ModelSelection` (or the hybrid config / a risk
 * setting) is the confirmed, admin-only human selection route. These are
 * properties of the whole source tree rather than of any one function, so they
 * live here as structural assertions — you cannot call the write that was never
 * written.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const relative = (file: string) => file.replace(SRC, "").split(sep).join("/");

describe("model selection is the only production-config write (D12/D13)", () => {
  it("writes ModelSelection from exactly one module", () => {
    // The single writer, reached only from the confirmed admin route, is what
    // makes "no recommendation/leader/readiness computation writes config"
    // structural rather than a matter of discipline.
    const writers = productionFiles(SRC).filter((file) =>
      /(prisma|tx|client)\.modelSelection\.(create|update|upsert|createMany|updateMany|delete)/.test(
        readCode(file),
      ),
    );
    expect(writers.map(relative).sort()).toEqual([
      "/lib/paper/model-selection.ts",
    ]);
  });

  it("reaches that writer only from the model-selection route", () => {
    const callers = productionFiles(SRC).filter(
      (file) =>
        readCode(file).includes("applyModelSelection") &&
        relative(file) !== "/lib/paper/model-selection.ts",
    );
    expect(callers.map(relative).sort()).toEqual([
      "/app/api/model-selection/route.ts",
    ]);
  });

  it("keeps the recommendation / leader read pure — it never writes ModelSelection", () => {
    // The model-eval evidence layer (readComparison / readStatLeaders /
    // readRecommendation) is decision support. No file in it may write the
    // selection it advises on.
    for (const file of sourceFiles(join(SRC, "lib", "model-eval"))) {
      const code = readCode(file);
      expect({
        file: relative(file),
        writes:
          /modelSelection\.(create|update|upsert|createMany|updateMany|delete)/.test(
            code,
          ),
      }).toEqual({ file: relative(file), writes: false });
    }
  });

  it("keeps the readiness read pure — it never writes ModelSelection or a risk config", () => {
    const code = readCode(join(SRC, "lib", "paper", "readiness.ts"));
    expect(/modelSelection\.(create|update|upsert)/.test(code)).toBe(false);
    expect(/paperRiskConfig\.(create|update|upsert)/.test(code)).toBe(false);
  });
});

describe("the model-selection route requires admin and confirmation (D12/D13)", () => {
  const route = readCode(
    join(SRC, "app", "api", "model-selection", "route.ts"),
  );

  it("rejects a non-admin server-side", () => {
    expect(route).toContain("requireSession()");
    expect(route).toContain('session.user.role !== "admin"');
  });

  it("requires an explicit confirmation and never reads a user id or role from the body", () => {
    // `confirmed: true` is the server-side confirmation gate; the strict schema
    // rejects a body carrying a userId or role.
    const lib = readCode(join(SRC, "lib", "paper", "model-selection.ts"));
    expect(lib).toContain("confirmed");
    expect(lib).toContain(".strict()");
    expect(route).not.toMatch(/body\.(userId|role)/);
    expect(route).not.toMatch(/parsed\.data\.(userId|role)/);
    // The actor comes from the session.
    expect(route).toContain("session.user.id");
  });

  it("is never statically rendered", () => {
    expect(route).toContain('dynamic = "force-dynamic"');
  });
});

describe("Dry Run is retired but its preview capability remains (D7)", () => {
  it("has no /autonomy/dry-run page and no /api/autonomy/dry-run route", () => {
    expect(
      existsSync(join(SRC, "app", "(app)", "autonomy", "dry-run", "page.tsx")),
    ).toBe(false);
    expect(
      existsSync(join(SRC, "app", "api", "autonomy", "dry-run", "route.ts")),
    ).toBe(false);
  });

  it("has no AutonomyDryRun screen and no Dry Run nav entry", () => {
    expect(
      existsSync(join(SRC, "components", "screens", "AutonomyDryRun.tsx")),
    ).toBe(false);
    const tabs = readCode(
      join(SRC, "components", "autonomy", "AutonomyTabs.tsx"),
    );
    expect(tabs).not.toMatch(/dry-run/i);
    expect(tabs).not.toMatch(/Dry Run/);
  });

  it("keeps runDryRun and planCycle importable and callable (not renamed Preview)", async () => {
    // The workflow was removed, not the capability. The preview function stays a
    // test/diagnostic utility — and it is NOT renamed "Preview" with a gate.
    const dryRun = await import("@/lib/paper/dry-run");
    const plan = await import("@/lib/paper/plan");
    expect(typeof dryRun.runDryRun).toBe("function");
    expect(typeof plan.planCycle).toBe("function");
    // Not renamed.
    expect((dryRun as Record<string, unknown>).runPreview).toBeUndefined();
    expect((plan as Record<string, unknown>).planPreview).toBeUndefined();
  });
});

describe("Paper Bot surfaces are admin-only, no shell first (D10)", () => {
  const APP = join(SRC, "app", "(app)", "autonomy");

  it("guards Performance, Activity, and Settings with requireAdmin before any read", () => {
    for (const page of [
      join(APP, "page.tsx"),
      join(APP, "activity", "page.tsx"),
      join(APP, "settings", "page.tsx"),
    ]) {
      const code = readCode(page);
      expect(code).toContain("requireAdmin()");
      // The guard precedes the first data read.
      const guardAt = code.indexOf("await requireAdmin()");
      const readAt = code.search(/await read[A-Z]/);
      expect(guardAt).toBeGreaterThan(-1);
      if (readAt > -1) expect(readAt).toBeGreaterThan(guardAt);
    }
  });

  it("308-redirects every legacy Paper Bot route", () => {
    const redirects: Array<[string[], string]> = [
      [["cycles", "page.tsx"], "/autonomy/activity"],
      [["positions", "page.tsx"], "/autonomy/activity"],
      [["review", "page.tsx"], "/autonomy"],
      [["readiness", "page.tsx"], "/autonomy"],
      [["configuration", "page.tsx"], "/autonomy/settings"],
    ];
    for (const [segments, target] of redirects) {
      const code = readCode(join(APP, ...segments));
      expect(code).toContain("permanentRedirect");
      expect(code).toContain(target);
      // A redirect must NOT sit behind requireAdmin — that would 403 a viewer
      // instead of forwarding the deep link. The guard lives on the target.
      expect(code).not.toContain("requireAdmin");
    }
  });
});
