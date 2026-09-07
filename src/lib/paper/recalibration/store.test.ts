import { prisma } from "@/lib/prisma";
import { SHRINKAGE_K } from "../config";
import { fitRecalibration, type BacktestBin } from "./fit";
import { isUnchanged, refitRecalibration } from "./store";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    recalibrationFit: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    calibrationBin: { findMany: jest.fn() },
    thresholdGrade: { findMany: jest.fn() },
    backtestRun: { findFirst: jest.fn(), findMany: jest.fn() },
    projection: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as unknown as {
  recalibrationFit: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  calibrationBin: { findMany: jest.Mock };
  thresholdGrade: { findMany: jest.Mock };
  backtestRun: { findFirst: jest.Mock; findMany: jest.Mock };
  projection: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

const NOW = new Date("2026-11-03T09:00:00Z");

function storedBins() {
  return [0.04, 0.13, 0.23, 0.33, 0.44, 0.53, 0.62, 0.69, 0.75, 0.82].map(
    (rate, index) => ({
      binIndex: index,
      predictedMean: (index + 0.5) / 10,
      observedRate: rate,
      thresholdObservations: 1_200,
    }),
  );
}

function equivalentFitInput(): { backtestBins: BacktestBin[] } {
  return { backtestBins: storedBins() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        recalibrationFit: {
          update: mockPrisma.recalibrationFit.update,
          create: mockPrisma.recalibrationFit.create,
        },
      }),
  );
  mockPrisma.calibrationBin.findMany.mockResolvedValue(storedBins());
  mockPrisma.thresholdGrade.findMany.mockResolvedValue([]);
  mockPrisma.recalibrationFit.findFirst.mockResolvedValue(null);
});

describe("refitRecalibration", () => {
  it("writes nothing when no stored backtest record can support a fit", async () => {
    // The campaign then refuses to size (`no_active_recalibration`) rather
    // than sizing from a raw probability. Refusing is the only alternative to
    // a No-Go, so the absence of a fit must be a first-class outcome and not
    // an exception.
    mockPrisma.backtestRun.findFirst.mockResolvedValue(null);

    const result = await refitRecalibration("baseline-v1", NOW);

    expect(result).toEqual({
      status: "no_reference_backtest",
      modelVersion: "baseline-v1",
    });
    expect(mockPrisma.recalibrationFit.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires the reference run to have contract-like bins, not merely to exist", async () => {
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-1",
      label: null,
    });
    await refitRecalibration("baseline-v1", NOW);

    const where = mockPrisma.backtestRun.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe("completed");
    expect(where.calibrationBins).toEqual({
      some: { population: "contract_like" },
    });
  });

  it("writes version 1 for a model version that has never been fitted", async () => {
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-1",
      label: "holdout",
    });
    mockPrisma.recalibrationFit.findFirst
      .mockResolvedValueOnce(null) // no active fit
      .mockResolvedValueOnce(null); // no highest version

    const result = await refitRecalibration("baseline-v1", NOW);

    expect(result).toEqual({
      status: "written",
      version: 1,
      liveObservationCount: 0,
    });
    const created = mockPrisma.recalibrationFit.create.mock.calls[0][0].data;
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);
    expect(created.modelVersion).toBe("baseline-v1");
    expect(created.backtestRunId).toBe("run-1");
    expect(created.method).toBe("pava_piecewise_linear/v1");
    expect(created.shrinkageK).toBe(SHRINKAGE_K);
    expect(created.fittedAt).toBe(NOW);
  });

  it("deactivates the previous fit and activates the new one in one transaction", async () => {
    // The partial unique index permits exactly one active fit per model
    // version, so these two writes must not be something a reader can land
    // between.
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-2",
      label: null,
    });
    mockPrisma.recalibrationFit.findFirst
      .mockResolvedValueOnce({
        id: "fit-1",
        version: 3,
        knots: [
          [0, 0],
          [1, 1],
        ],
        liveObservationCount: 0,
        backtestRunId: "run-1",
        method: "pava_piecewise_linear/v1",
        shrinkageK: SHRINKAGE_K,
      })
      .mockResolvedValueOnce({ version: 3 });

    const result = await refitRecalibration("baseline-v1", NOW);

    expect(result.status).toBe("written");
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.recalibrationFit.update).toHaveBeenCalledWith({
      where: { id: "fit-1" },
      data: { isActive: false },
    });
    expect(
      mockPrisma.recalibrationFit.create.mock.calls[0][0].data.version,
    ).toBe(4);
  });

  it("writes no new version when the fit says exactly what the active one says", async () => {
    // Version numbers mark real changes. A nightly job that bumped one every
    // night would make "the active correction is versioned" true and useless.
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-1",
      label: null,
    });
    const identical = fitRecalibration({
      ...equivalentFitInput(),
      liveObservations: [],
      shrinkageK: SHRINKAGE_K,
    });
    mockPrisma.recalibrationFit.findFirst.mockResolvedValueOnce({
      id: "fit-9",
      version: 9,
      knots: identical.knots,
      liveObservationCount: 0,
      backtestRunId: "run-1",
      method: identical.method,
      shrinkageK: identical.shrinkageK,
    });

    const result = await refitRecalibration("baseline-v1", NOW);

    expect(result).toEqual({ status: "unchanged", version: 9 });
    expect(mockPrisma.recalibrationFit.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("restricts live evidence to contract-like grades of the same model version", async () => {
    // Live evidence and the prior must describe the same kind of prediction,
    // and a different model's results are not evidence about this one.
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-1",
      label: null,
    });
    await refitRecalibration("sim-v2", NOW);

    const where = mockPrisma.thresholdGrade.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      contractLike: true,
      projection: { modelVersion: "sim-v2" },
    });
  });

  it("reads only the contract-like bins of the reference run", async () => {
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-7",
      label: null,
    });
    await refitRecalibration("baseline-v1", NOW);

    expect(mockPrisma.calibrationBin.findMany.mock.calls[0][0].where).toEqual({
      backtestRunId: "run-7",
      population: "contract_like",
    });
  });

  it("records the live window from the graded observations it used", async () => {
    mockPrisma.backtestRun.findFirst.mockResolvedValue({
      id: "run-1",
      label: null,
    });
    mockPrisma.thresholdGrade.findMany.mockResolvedValue([
      {
        statedProbability: 0.55,
        outcome: true,
        gradedAt: new Date("2026-10-20T00:00:00Z"),
      },
      {
        statedProbability: 0.61,
        outcome: false,
        gradedAt: new Date("2026-11-02T00:00:00Z"),
      },
    ]);
    mockPrisma.recalibrationFit.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await refitRecalibration("baseline-v1", NOW);

    const created = mockPrisma.recalibrationFit.create.mock.calls[0][0].data;
    expect(created.liveObservationCount).toBe(2);
    expect(created.liveWindowFrom).toEqual(new Date("2026-10-20T00:00:00Z"));
    expect(created.liveWindowTo).toEqual(new Date("2026-11-02T00:00:00Z"));
  });
});

describe("isUnchanged", () => {
  const proposed = fitRecalibration({
    ...equivalentFitInput(),
    liveObservations: [],
    shrinkageK: SHRINKAGE_K,
  });
  const current = {
    knots: proposed.knots,
    liveObservationCount: 0,
    backtestRunId: "run-1",
    method: proposed.method,
    shrinkageK: proposed.shrinkageK,
  };

  it("is true only when every behaviour-affecting input matches", () => {
    expect(isUnchanged(current, proposed, "run-1")).toBe(true);
  });

  it("is false when the reference backtest run changed", () => {
    // A different stored record is different evidence, even if the arithmetic
    // happened to land on the same curve.
    expect(isUnchanged(current, proposed, "run-2")).toBe(false);
  });

  it("is false when the live sample grew, even if the knots did not move", () => {
    expect(
      isUnchanged({ ...current, liveObservationCount: 5 }, proposed, "run-1"),
    ).toBe(false);
  });

  it("is false when the method or the shrinkage constant changed", () => {
    expect(
      isUnchanged({ ...current, method: "isotonic/v2" }, proposed, "run-1"),
    ).toBe(false);
    expect(isUnchanged({ ...current, shrinkageK: 50 }, proposed, "run-1")).toBe(
      false,
    );
  });

  it("is false when the knots differ at all", () => {
    expect(
      isUnchanged(
        {
          ...current,
          knots: [
            [0, 0],
            [1, 1],
          ],
        },
        proposed,
        "run-1",
      ),
    ).toBe(false);
  });
});
