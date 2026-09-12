import type { PaperPortfolio } from "../../../generated/prisma/enums";
import type { PaperRiskModeName } from "./model-eval";
import type { CycleRowDto, PositionRowDto } from "./autonomy";

/**
 * Paper Bot Lab contracts (design doc §8).
 *
 * A "bot" is a `PaperCampaign` — the three canonical comparison bots
 * (`isComparison = true`) and any number of custom Lab bots (`isComparison =
 * false`). These DTOs describe ALL of them uniformly; Model Performance's own
 * scorecard DTO (`PortfolioScorecardDto`) stays separate and comparison-only.
 *
 * Contract rules that mirror the scorecard's:
 *
 * - `null` is not `0`. `activeBankrollCents === null` means mark-to-market was
 *   unavailable (a degraded read), distinct from a real zero; everything that
 *   depends on the live mark (`netPnlCents`, `returnPct`, `maxDrawdownBps`) is
 *   null too rather than silently settling-only.
 * - Money is signed cents, never a pre-formatted string — only the SIGN of a P&L
 *   figure takes colour, a display concern.
 * - These are paper figures, permanently, and are never aggregated across bots.
 */
export type PaperBotSummaryDto = {
  id: string;
  /** The bot NAME — the campaign label. */
  name: string;
  /** The engine the bot prices from. */
  engine: PaperPortfolio;
  riskMode: PaperRiskModeName;
  startingBankrollCents: number;
  /** null = mark-to-market unavailable (degraded). Distinct from a real 0. */
  activeBankrollCents: number | null;
  /** Active bankroll + withdrawals − starting; null when the mark is degraded. */
  netPnlCents: number | null;
  returnPct: number | null;
  /** null when active bankroll is unavailable. */
  maxDrawdownBps: number | null;
  positionCount: number;
  autonomyEnabled: boolean;
  /** True for the canonical Baseline/Simulation/Hybrid bots. */
  isComparison: boolean;
};

/** One point on a bot's bankroll-over-time chart (from the append-only ledger). */
export type BankrollHistoryPointDto = {
  at: string;
  /** Running settled balance after the entry — the ledger's own field. */
  settledCents: number;
};

/**
 * A single bot's detail (design doc §8, Bot detail): the summary plus a
 * bankroll-history series, its positions/contracts, and its recent cycles.
 */
export type PaperBotDetailDto = {
  summary: PaperBotSummaryDto;
  withdrawnCents: number;
  highWaterMarkCents: number;
  /** Chronological, oldest → newest, for the bankroll chart. */
  bankrollHistory: BankrollHistoryPointDto[];
  positions: PositionRowDto[];
  openPositionCount: number;
  settledPositionCount: number;
  recentCycles: CycleRowDto[];
};
