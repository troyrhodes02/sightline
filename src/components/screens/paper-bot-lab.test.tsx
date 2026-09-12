/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import { PaperBotList } from "./PaperBotList";
import { PaperBotDetail } from "./PaperBotDetail";
import { theme } from "@/theme";
import type {
  PaperBotSummaryDto,
  PaperBotDetailDto,
} from "@/lib/dto/paper-bots";

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function draw(node: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);
}

function bot(over: Partial<PaperBotSummaryDto> = {}): PaperBotSummaryDto {
  return {
    id: "bot-1",
    name: "Slot Fade",
    engine: "hybrid",
    riskMode: "moderate",
    startingBankrollCents: 100_000,
    activeBankrollCents: 104_250,
    netPnlCents: 4_250,
    returnPct: 4.25,
    maxDrawdownBps: 180,
    positionCount: 12,
    autonomyEnabled: true,
    isComparison: false,
    ...over,
  };
}

describe("Paper Bot list", () => {
  it("renders every bot with its name, and marks a comparison bot subtly", () => {
    draw(
      <PaperBotList
        bots={[
          bot({ id: "b1", name: "Baseline", isComparison: true }),
          bot({ id: "b2", name: "Slot Fade", isComparison: false }),
        ]}
      />,
    );
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    expect(screen.getByText("Slot Fade")).toBeInTheDocument();
    expect(screen.getByText("comparison")).toBeInTheDocument();
  });

  it("offers a New bot affordance", () => {
    draw(<PaperBotList bots={[bot()]} />);
    expect(
      screen.getByRole("button", { name: "+ New bot" }),
    ).toBeInTheDocument();
  });

  it("opens the create dialog from the New bot affordance", () => {
    draw(<PaperBotList bots={[bot()]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New bot" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
  });

  it("renders a designed empty state when there are no bots", () => {
    draw(<PaperBotList bots={[]} />);
    expect(screen.getByText("No bots yet.")).toBeInTheDocument();
  });

  it("shows a signed net P&L, and a degraded bot renders unavailable not zero", () => {
    draw(
      <PaperBotList
        bots={[
          bot({
            id: "deg",
            name: "Degraded",
            activeBankrollCents: null,
            netPnlCents: null,
            returnPct: null,
            maxDrawdownBps: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });
});

describe("Paper Bot create form", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    global.fetch = jest.fn();
  });

  function openForm() {
    draw(<PaperBotList bots={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New bot" }));
  }

  it("blocks submit and shows a name error when the name is empty", async () => {
    openForm();
    // Default name is empty; Start should not POST.
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("A bot needs a name.")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks submit when the bankroll is not above zero", async () => {
    openForm();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Test bot" },
    });
    fireEvent.change(screen.getByLabelText(/Starting bankroll/), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(
      await screen.findByText("Enter an amount above zero."),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("POSTs to the create route with cents, then routes to the new bot", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ botId: "new-bot" }),
    });
    openForm();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Slot Fade" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/paper/bots");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.name).toBe("Slot Fade");
    // $1000 default → 100000 cents.
    expect(body.startingBankrollCents).toBe(100_000);
    expect(body.withdrawalCeilingMultiple).toBe(1.5);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/autonomy/bots/new-bot"),
    );
  });

  it("surfaces a server error inline without routing away", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ message: "The bot could not be created." }),
    });
    openForm();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Bad bot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(
      await screen.findByText("The bot could not be created."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

function detail(over: Partial<PaperBotDetailDto> = {}): PaperBotDetailDto {
  return {
    summary: bot(),
    withdrawnCents: 0,
    highWaterMarkCents: 104_500,
    bankrollHistory: [
      { at: "2026-10-26T16:00:00.000Z", settledCents: 100_000 },
      { at: "2026-10-27T16:00:00.000Z", settledCents: 104_250 },
    ],
    positions: [
      {
        positionId: "p1",
        contractId: "k1",
        playerName: "Ja'Marr Chase",
        statType: "receiving_yards",
        threshold: 74.5,
        side: "yes",
        contracts: 32,
        costBasisCents: 1_728,
        feesPaidCents: 32,
        intendedStakeCents: 1_775,
        unfilledStakeCents: 0,
        markCents: 1_920,
        status: "open",
        settlementResult: null,
        realizedPnlCents: null,
        openedAt: "2026-10-26T16:20:00.000Z",
        settledAt: null,
      },
    ],
    openPositionCount: 1,
    settledPositionCount: 0,
    recentCycles: [
      {
        cycleId: "c1",
        startedAt: "2026-10-26T16:20:00.000Z",
        gameLabel: "CIN @ PIT",
        kickoffAt: "2026-10-26T17:00:00.000Z",
        outcome: "ok",
        reason: null,
        candidatesEvaluated: 8,
        candidatesSized: 3,
        candidatesFilled: 1,
        stakedCents: 1_760,
      },
    ],
    ...over,
  };
}

describe("Paper Bot detail", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("renders the name, chips, summary figures, positions, and cycles", () => {
    draw(<PaperBotDetail detail={detail()} />);
    expect(
      screen.getByRole("heading", { name: "Slot Fade" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    // Summary figures.
    expect(screen.getByText("Starting")).toBeInTheDocument();
    expect(screen.getByText("Net P&L")).toBeInTheDocument();
    // Positions table.
    expect(screen.getByText(/Ja'Marr Chase/)).toBeInTheDocument();
    // Cycles table.
    expect(screen.getByText(/CIN @ PIT/)).toBeInTheDocument();
  });

  it("renders the bankroll chart summary from history", () => {
    draw(<PaperBotDetail detail={detail()} />);
    // The themed BankrollChart carries an accessible text summary.
    expect(screen.getByText(/Bankroll history, 2 points/)).toBeInTheDocument();
  });

  it("shows a Pause control for an enabled bot", () => {
    draw(<PaperBotDetail detail={detail()} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("shows a Resume control for a paused bot", () => {
    draw(
      <PaperBotDetail
        detail={detail({ summary: bot({ autonomyEnabled: false }) })}
      />,
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });

  it("posts a pause action to the manage route", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    draw(<PaperBotDetail detail={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/paper/bots/bot-1");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      action: "pause",
    });
  });

  it("renders empty states for a bot that has done nothing", () => {
    draw(
      <PaperBotDetail
        detail={detail({
          positions: [],
          recentCycles: [],
          openPositionCount: 0,
          settledPositionCount: 0,
        })}
      />,
    );
    expect(screen.getByText("No positions yet.")).toBeInTheDocument();
    expect(screen.getByText("No cycles yet.")).toBeInTheDocument();
  });
});
