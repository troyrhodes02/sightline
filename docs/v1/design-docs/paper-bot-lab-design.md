# Paper Bot Lab — design decisions (owner-approved, autonomous build)

Goal: let the admin create named, independent paper bots — each a chosen **engine × risk mode × starting bankroll** — start them with one click, see them all in a list, and click into a per-bot detail (bankroll graph, the contracts it took, P&L/drawdown). Named, manageable, simple.

This **generalizes the existing paper machinery** rather than rebuilding it: a `PaperCampaign` is already an isolated bot (own bankroll, ledger, cycles, positions, breaches, high-water, Kelly sizing, breakers, withdrawals). We make bots first-class and freely configurable while keeping Pitch 11's Baseline/Simulation/Hybrid comparison intact.

## Decisions

1. **A "bot" = a `PaperCampaign` row.** Reuse `label` as the bot **name** (already nullable). Add `isComparison Boolean @default(false)`. Drop `@@unique([evaluationCampaignId, portfolio])` (was one-per-engine) so many bots can share an engine. Add `@@index([evaluationCampaignId, isComparison])`.
2. **The 3 canonical comparison bots stay.** Backfill the existing baseline/simulation/hybrid portfolios to `isComparison = true` and give them names ("Baseline", "Simulation", "Hybrid"). **Model Performance keeps reading exactly those 3** (`readPortfolioScorecards` filters `isComparison = true`) — its engine comparison is untouched. Custom bots are `isComparison = false`.
3. **Every bot has its OWN risk config.** The 3 comparison bots share the campaign config (via a fan-out in `saveConfiguration` to the comparison bots — keeps them apples-to-apples, D5/D11). A custom bot gets its own config at creation. The cycle reads **each bot's own latest `PaperRiskConfig`** (revert the single-shared-config read to per-bot; every bot now has a config, so the old "sibling had no config → skipped" bug can't recur).
4. **`engine` = the `portfolio` field** (baseline/simulation/hybrid). Hybrid bots price each stat from the current `ModelSelection`; baseline/simulation bots from their fixed engine. (Reuse `PortfolioTarget.modelVersionForStat`.)
5. **The cycle iterates ALL enabled bots** (comparison + custom) under one `PaperEvaluationCampaign`, each with its own config. Kill switch stays campaign-wide (parent). Breaches per bot.
6. **Config-writer invariant:** creating a bot writes a `PaperRiskConfig` — a *human* create action, not auto-tuning. Route it through a sanctioned module and add that module to the "risk config written from these modules" invariant test with a clear rationale (spirit preserved: nothing derives a risk parameter from P&L).
7. **Routes:** `POST /api/paper/bots` (create: name, engine, mode|custom params, startingBankrollCents, withdrawalCeilingMultiple), `POST /api/paper/bots/[id]` (rename / pause / kill), server-side admin-gated. `userId`/role from session, never the body.
8. **Reads:** `readPaperBots(evaluationCampaignId)` → all bots (name, engine, mode, bankroll, P&L, return, drawdown, positions, enabled) reusing the scorecard math. `readBotDetail(botId)` → bankroll-history series (for the chart), positions/contracts, P&L/drawdown summary, cycle history. Reuse existing paper reads/components.
9. **UI (admin-only, under Paper Bot):**
   - **Bots list** — every bot as a card/row (name · engine · mode · bankroll · P&L up/down) + **"+ New bot"**. This is the Paper Bot landing (or a "Bots" tab).
   - **Create form** — name, engine (Baseline/Simulation/Hybrid), mode (Conservative/Moderate/Aggressive), starting bankroll, withdrawal ceiling → **Start**. Simple, one screen/dialog.
   - **Bot detail** (`/autonomy/bots/[id]`) — bankroll-over-time graph (reuse `BankrollChart`), the positions/contracts it took (reuse `PositionsTable`) with cost/P&L/win-loss, P&L + drawdown + return summary, cycle history. Pause / Kill / Rename per bot.
10. **Constraint (unchanged):** bots only act when the scheduled pipeline runs; a new bot accumulates as game windows pass. No live money; paper only; ledgers isolated; no auto-promotion.
11. **This run merges to `main`** and applies the migration to prod (owner instruction), after full verification.
