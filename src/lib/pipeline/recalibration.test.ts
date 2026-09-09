import { join } from "node:path";
import { readCode } from "@/lib/testing/source";
import { prisma } from "@/lib/prisma";
import * as store from "@/lib/paper/recalibration/store";
import { runRecalibrationFit } from "./recalibration";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineRun: { create: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/paper/recalibration/store", () => ({
  modelVersionsToRefit: jest.fn(),
  refitRecalibration: jest.fn(),
}));

const mockPrisma = prisma as unknown as {
  pipelineRun: { create: jest.Mock; update: jest.Mock };
};
const mockStore = store as unknown as {
  modelVersionsToRefit: jest.Mock;
  refitRecalibration: jest.Mock;
};

const NOW = new Date("2026-11-03T09:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.pipelineRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.pipelineRun.update.mockResolvedValue({});
});

describe("runRecalibrationFit", () => {
  it("records nothing at all when there is nothing to fit", async () => {
    // Dormancy derived from stored state, exactly as with price refresh: an
    // empty run row every night would be noise, not history.
    mockStore.modelVersionsToRefit.mockResolvedValue([]);

    const result = await runRecalibrationFit({ invocationId: "gh:1:1" }, NOW);

    expect(result.skipped).toBe("not_expected");
    expect(mockPrisma.pipelineRun.create).not.toHaveBeenCalled();
  });

  it("records a running row, then marks it succeeded", async () => {
    mockStore.modelVersionsToRefit.mockResolvedValue(["baseline-v1"]);
    mockStore.refitRecalibration.mockResolvedValue({
      status: "written",
      version: 2,
      liveObservationCount: 41,
    });

    const result = await runRecalibrationFit({ invocationId: "gh:1:1" }, NOW);

    const created = mockPrisma.pipelineRun.create.mock.calls[0][0].data;
    expect(created.category).toBe("recalibration_fit");
    expect(created.status).toBe("running");
    expect(created.invocationId).toBe("gh:1:1");
    expect(created.startedAt).toBe(NOW);

    expect(mockPrisma.pipelineRun.update.mock.calls[0][0].data.status).toBe(
      "succeeded",
    );
    expect(result.fitsWritten).toBe(1);
  });

  it("treats a duplicate scheduler delivery as a structural no-op", async () => {
    // The [category, invocationId] unique index IS the idempotency mechanism.
    // A re-delivered cron must not race the original to write a second
    // version of the correction.
    mockStore.modelVersionsToRefit.mockResolvedValue(["baseline-v1"]);
    const duplicate = Object.assign(new Error("unique"), { code: "P2002" });
    mockPrisma.pipelineRun.create.mockRejectedValue(duplicate);

    const result = await runRecalibrationFit({ invocationId: "gh:1:1" }, NOW);

    expect(result.skipped).toBe("coalesced");
    expect(mockStore.refitRecalibration).not.toHaveBeenCalled();
    expect(result.fitsWritten).toBe(0);
  });

  it("rethrows a create failure that is not a duplicate", async () => {
    mockStore.modelVersionsToRefit.mockResolvedValue(["baseline-v1"]);
    mockPrisma.pipelineRun.create.mockRejectedValue(new Error("connection"));

    await expect(
      runRecalibrationFit({ invocationId: "gh:1:1" }, NOW),
    ).rejects.toThrow("connection");
  });

  it("counts the three refit outcomes separately", async () => {
    mockStore.modelVersionsToRefit.mockResolvedValue(["a", "b", "c"]);
    mockStore.refitRecalibration
      .mockResolvedValueOnce({
        status: "written",
        version: 4,
        liveObservationCount: 10,
      })
      .mockResolvedValueOnce({ status: "unchanged", version: 3 })
      .mockResolvedValueOnce({
        status: "no_reference_backtest",
        modelVersion: "c",
      });

    const result = await runRecalibrationFit({ invocationId: "gh:1:1" }, NOW);

    expect(result.fitsWritten).toBe(1);
    expect(result.fitsUnchanged).toBe(1);
    expect(result.withoutReference).toBe(1);
    expect(result.modelVersionsConsidered).toBe(3);
  });

  it("keeps the fits that succeeded when one model version throws", async () => {
    // A partial failure must not lose the work that completed, and the run is
    // marked failed so /health reports the last SUCCESSFUL fit honestly.
    mockStore.modelVersionsToRefit.mockResolvedValue(["a", "b"]);
    mockStore.refitRecalibration
      .mockResolvedValueOnce({
        status: "written",
        version: 1,
        liveObservationCount: 0,
      })
      .mockRejectedValueOnce(new Error("bad bins"));

    const result = await runRecalibrationFit({ invocationId: "gh:1:1" }, NOW);

    expect(result.fitsWritten).toBe(1);
    const update = mockPrisma.pipelineRun.update.mock.calls[0][0].data;
    expect(update.status).toBe("failed");
    expect(update.errorMessage).toBe(
      "one or more model versions could not be refitted",
    );
  });

  it("leaks nothing about the failure into the recorded message", async () => {
    // A run row is operational history, not a stack trace. Whatever the
    // underlying error said stays out of it.
    mockStore.modelVersionsToRefit.mockResolvedValue(["a"]);
    mockStore.refitRecalibration.mockRejectedValue(
      new Error("connect ECONNREFUSED postgresql://user:secret@host:5432/db"),
    );

    await runRecalibrationFit({ invocationId: "gh:1:1" }, NOW);

    const message = mockPrisma.pipelineRun.update.mock.calls[0][0].data
      .errorMessage as string;
    expect(message).not.toMatch(/postgres|secret|ECONNREFUSED/);
  });
});

describe("the recalibration route", () => {
  const routeCode = readCode(
    join(
      process.cwd(),
      "src",
      "app",
      "api",
      "pipeline",
      "recalibration-fit",
      "route.ts",
    ),
  );

  it("is machine-authenticated and never reads a user identity", () => {
    expect(routeCode).toContain("verifyPipelineToken");
    expect(routeCode).not.toContain("requireSession");
    expect(routeCode).not.toContain("requireAdmin");
    expect(routeCode).not.toMatch(/userId/);
  });

  it("is never statically rendered", () => {
    expect(routeCode).toContain('dynamic = "force-dynamic"');
  });

  it("answers an unconfigured token distinctly from a wrong one", () => {
    // A misconfigured deploy must be loud, and distinguishable from a caller
    // with bad credentials.
    expect(routeCode).toContain("upstream_unavailable");
    expect(routeCode).toContain("unauthorized");
  });

  it("returns nothing internal on failure", () => {
    expect(routeCode).toContain(
      'jsonError("internal_error", "The recalibration refit failed.")',
    );
  });
});

describe("the nightly workflow", () => {
  const workflow = readCode(
    join(process.cwd(), ".github", "workflows", "pipeline-nightly.yml"),
  );

  it("refits after grading, not before", () => {
    // Grading produces the live evidence the fit is built from. Running the
    // refit first would fit last night's evidence every night.
    expect(workflow.indexOf("Grade completed games")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Refit probability recalibration")).toBeGreaterThan(
      workflow.indexOf("Grade completed games"),
    );
  });

  it("passes the same invocation id the other phases use", () => {
    expect(workflow).toContain(
      "gh:${{ github.run_id }}:${{ github.run_attempt }}",
    );
  });
});
