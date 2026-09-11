import { prisma } from "@/lib/prisma";
import { forceOverride } from "./controls";

jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: jest.fn() },
}));

const mockPrisma = prisma as unknown as { $transaction: jest.Mock };

const NOW = new Date("2026-11-15T17:00:00Z");

/**
 * Two open breaches: one halting condition the operator is shown and
 * acknowledges, and one non-halting warning the override screen never renders.
 */
const HALTING = { id: "b-calibration", condition: "calibration" };
const WARNING = { id: "b-warning", condition: "drawdown_warning" };

function transactionWith(active: Array<{ id: string; condition: string }>) {
  const updates: Array<{ id: string; resolution: string }> = [];
  const controlEvents: Array<Record<string, unknown>> = [];

  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)({
      paperCampaign: {
        // The kill switch is campaign-wide and read through the parent (PME-1).
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          evaluationCampaign: { killSwitchEngaged: false },
        }),
      },
      paperBreach: {
        findMany: jest.fn().mockResolvedValue(active),
        update: jest.fn().mockImplementation(async (args: never) => {
          const call = args as unknown as {
            where: { id: string };
            data: { resolution: string };
          };
          updates.push({
            id: call.where.id,
            resolution: call.data.resolution,
          });
        }),
      },
      paperControlEvent: {
        create: jest.fn().mockImplementation(async (args: never) => {
          controlEvents.push((args as unknown as { data: never }).data);
        }),
      },
    }),
  );

  return { updates, controlEvents };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Force Override records only what was put to the operator", () => {
  it("leaves a non-halting warning alone", async () => {
    // The acknowledgement checks are computed against the halting conditions,
    // and the override screen renders only those. Marking the warning
    // `force_overridden` too would put it in the readiness evidence and the
    // safety log as a condition somebody deliberately overruled, when nobody
    // was ever asked about it.
    const { updates, controlEvents } = transactionWith([HALTING, WARNING]);

    await forceOverride(
      "c1",
      "u1",
      [HALTING.id],
      new Set(["calibration", "drawdown_warning"]),
      NOW,
    );

    expect(updates).toEqual([
      { id: HALTING.id, resolution: "force_overridden" },
    ]);
    expect(controlEvents[0]).toMatchObject({
      detail: {
        breachIds: [HALTING.id],
        conditions: ["calibration"],
      },
    });
  });

  it("still overrides every halting condition", async () => {
    const exposure = { id: "b-exposure", condition: "exposure" };
    const { updates } = transactionWith([HALTING, exposure, WARNING]);

    await forceOverride(
      "c1",
      "u1",
      [HALTING.id, exposure.id],
      new Set(["calibration", "exposure", "drawdown_warning"]),
      NOW,
    );

    expect(updates.map((update) => update.id).sort()).toEqual(
      [HALTING.id, exposure.id].sort(),
    );
  });
});
