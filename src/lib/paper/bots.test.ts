import { prisma } from "@/lib/prisma";
import { createBot, renameBot, setBotAutonomy } from "./bots";
import { RISK_PRESETS } from "./config";

jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: jest.fn() },
}));

const mockPrisma = prisma as unknown as { $transaction: jest.Mock };

const NOW = new Date("2026-11-15T17:00:00Z");

type TxWrites = {
  campaignCreates: Array<Record<string, unknown>>;
  ledgerCreates: Array<Record<string, unknown>>;
  riskConfigCreates: Array<Record<string, unknown>>;
  controlEvents: Array<Record<string, unknown>>;
  campaignUpdates: Array<{ id: string; data: Record<string, unknown> }>;
};

function installTransaction(): TxWrites {
  const writes: TxWrites = {
    campaignCreates: [],
    ledgerCreates: [],
    riskConfigCreates: [],
    controlEvents: [],
    campaignUpdates: [],
  };
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)({
      paperEvaluationCampaign: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "ec1" }),
      },
      paperCampaign: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "bot1" }),
        create: jest.fn().mockImplementation(async (args: never) => {
          const call = args as { data: Record<string, unknown> };
          writes.campaignCreates.push(call.data);
          return { id: "bot1" };
        }),
        update: jest.fn().mockImplementation(async (args: never) => {
          const call = args as {
            where: { id: string };
            data: Record<string, unknown>;
          };
          writes.campaignUpdates.push({ id: call.where.id, data: call.data });
        }),
      },
      paperLedgerEntry: {
        create: jest.fn().mockImplementation(async (args: never) => {
          writes.ledgerCreates.push((args as { data: never }).data);
        }),
      },
      paperRiskConfig: {
        create: jest.fn().mockImplementation(async (args: never) => {
          writes.riskConfigCreates.push((args as { data: never }).data);
          return { id: "cfg1" };
        }),
      },
      paperControlEvent: {
        create: jest.fn().mockImplementation(async (args: never) => {
          writes.controlEvents.push((args as { data: never }).data);
        }),
      },
    }),
  );
  return writes;
}

beforeEach(() => jest.clearAllMocks());

describe("createBot", () => {
  it("creates the campaign, opening balance, and config atomically in one transaction", async () => {
    const writes = installTransaction();

    const botId = await createBot(
      {
        evaluationCampaignId: "ec1",
        name: "My Aggressive Baseline",
        engine: "baseline",
        mode: "aggressive",
        startingBankrollCents: 50_000,
        withdrawalCeilingMultiple: 2,
        actorUserId: "u1",
      },
      NOW,
    );

    expect(botId).toBe("bot1");
    // Exactly one $transaction — all three writes share one boundary.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // The campaign is a custom bot: isComparison=false, label=name, engine as
    // portfolio, enabled, seeded high-water at the starting bankroll.
    expect(writes.campaignCreates).toHaveLength(1);
    expect(writes.campaignCreates[0]).toMatchObject({
      evaluationCampaignId: "ec1",
      portfolio: "baseline",
      label: "My Aggressive Baseline",
      isComparison: false,
      startingBankrollCents: 50_000,
      highWaterMarkCents: 50_000,
      autonomyEnabled: true,
    });

    // Opening balance ledger fact.
    expect(writes.ledgerCreates).toHaveLength(1);
    expect(writes.ledgerCreates[0]).toMatchObject({
      campaignId: "bot1",
      kind: "opening_balance",
      amountCents: 50_000,
      balanceAfterCents: 50_000,
    });

    // Its OWN risk config, resolved from the chosen mode's preset.
    expect(writes.riskConfigCreates).toHaveLength(1);
    expect(writes.riskConfigCreates[0]).toMatchObject({
      campaignId: "bot1",
      mode: "aggressive",
      kellyFraction: RISK_PRESETS.aggressive.kellyFraction,
      perGameCapPct: RISK_PRESETS.aggressive.perGameCapPct,
      drawdownHaltPct: RISK_PRESETS.aggressive.drawdownHaltPct,
      createdByUserId: "u1",
    });
  });

  it("resolves a preset mode ignoring stray custom params", async () => {
    const writes = installTransaction();
    await createBot(
      {
        evaluationCampaignId: "ec1",
        name: "Preset bot",
        engine: "hybrid",
        mode: "conservative",
        // Custom params supplied but must be ignored for a preset mode.
        customParams: { kellyFraction: 0.99, perGameCapPct: 40 },
        startingBankrollCents: 100_000,
        withdrawalCeilingMultiple: 1.5,
        actorUserId: "u1",
      },
      NOW,
    );
    expect(writes.riskConfigCreates[0]).toMatchObject({
      mode: "conservative",
      kellyFraction: RISK_PRESETS.conservative.kellyFraction,
      perGameCapPct: RISK_PRESETS.conservative.perGameCapPct,
    });
  });

  it("applies custom params for a custom mode", async () => {
    const writes = installTransaction();
    await createBot(
      {
        evaluationCampaignId: "ec1",
        name: "Custom bot",
        engine: "simulation",
        mode: "custom",
        customParams: {
          kellyFraction: 0.4,
          perGameCapPct: 6,
          perSlateCapPct: 20,
          drawdownHaltPct: 12,
        },
        startingBankrollCents: 100_000,
        withdrawalCeilingMultiple: 1.5,
        actorUserId: "u1",
      },
      NOW,
    );
    expect(writes.riskConfigCreates[0]).toMatchObject({
      mode: "custom",
      kellyFraction: 0.4,
      perGameCapPct: 6,
      perSlateCapPct: 20,
      drawdownHaltPct: 12,
    });
  });

  it("rejects a non-positive starting bankroll", async () => {
    installTransaction();
    await expect(
      createBot(
        {
          evaluationCampaignId: "ec1",
          name: "Bad bot",
          engine: "baseline",
          mode: "conservative",
          startingBankrollCents: 0,
          withdrawalCeilingMultiple: 1.5,
          actorUserId: "u1",
        },
        NOW,
      ),
    ).rejects.toThrow();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("renameBot / setBotAutonomy", () => {
  it("renames a bot by updating its label", async () => {
    const writes = installTransaction();
    await renameBot("bot1", "  New Name  ", "u1", NOW);
    expect(writes.campaignUpdates).toEqual([
      { id: "bot1", data: { label: "New Name" } },
    ]);
  });

  it("pauses a bot by disabling its own autonomy", async () => {
    const writes = installTransaction();
    await setBotAutonomy("bot1", false, "u1", NOW);
    expect(writes.campaignUpdates).toEqual([
      { id: "bot1", data: { autonomyEnabled: false } },
    ]);
    expect(writes.controlEvents[0]).toMatchObject({ kind: "disabled" });
  });

  it("resumes a bot by enabling its own autonomy", async () => {
    const writes = installTransaction();
    await setBotAutonomy("bot1", true, "u1", NOW);
    expect(writes.campaignUpdates).toEqual([
      { id: "bot1", data: { autonomyEnabled: true } },
    ]);
    expect(writes.controlEvents[0]).toMatchObject({ kind: "enabled" });
  });
});
