"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import { AutonomyHeading, formatCents } from "@/components/autonomy/primitives";
import { BotEngineChip, BotRiskModeChip } from "@/components/autonomy/BotChips";
import { CreateBotDialog } from "@/components/autonomy/CreateBotDialog";
import type { PaperBotSummaryDto } from "@/lib/dto/paper-bots";

/**
 * Paper Bot → Bots (design doc §9). The Paper Bot Lab landing: every bot — the
 * three canonical comparison bots and any number of custom Lab bots — as a dense
 * scannable row, plus a prominent "+ New bot" affordance.
 *
 * Ledger money is neutral-toned; only a signed P&L takes colour, and its sign is
 * always printed so the encoding survives greyscale (the Autonomy vocabulary
 * rule). A comparison bot is distinguished with a small subtle tag, listed
 * together with the custom bots rather than in a separate section.
 */
export function PaperBotList({ bots }: { bots: PaperBotSummaryDto[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Paper Bot"
        detail="Paper mode · all figures simulated · never live"
        action={
          <Button variant="outlined" onClick={() => setOpen(true)}>
            + New bot
          </Button>
        }
      />
      <AutonomyTabs current="/autonomy/bots" />

      <Paper>
        {bots.length === 0 ? (
          <EmptyState
            title="No bots yet."
            detail="Create a bot — an engine, a risk mode, and a starting bankroll — and it begins accumulating paper positions on the next scheduled cycle."
          />
        ) : (
          <Stack
            divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
          >
            {bots.map((bot) => (
              <BotRow key={bot.id} bot={bot} />
            ))}
          </Stack>
        )}
      </Paper>

      <CreateBotDialog open={open} onClose={() => setOpen(false)} />
    </Stack>
  );
}

function BotRow({ bot }: { bot: PaperBotSummaryDto }) {
  const netTone =
    bot.netPnlCents === null
      ? "text.muted"
      : bot.netPnlCents > 0
        ? "primary.main"
        : bot.netPnlCents < 0
          ? "error.main"
          : "text.primary";

  return (
    <Box
      component={Link}
      href={`/autonomy/bots/${bot.id}`}
      sx={{
        display: "block",
        px: 2,
        py: 1.75,
        textDecoration: "none",
        color: "inherit",
        "&:hover": { backgroundColor: "action.hover" },
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 1, sm: 2 }}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", flex: 1, minWidth: 0 }}
        >
          <Typography variant="body1" sx={{ color: "text.primary" }}>
            {bot.name}
          </Typography>
          <BotEngineChip engine={bot.engine} />
          <BotRiskModeChip mode={bot.riskMode} />
          {bot.isComparison ? (
            <Chip
              size="small"
              variant="outlined"
              label="comparison"
              sx={{ color: "text.muted", borderColor: "divider" }}
            />
          ) : null}
          {!bot.autonomyEnabled ? (
            <Typography variant="caption" sx={{ color: "warning.main" }}>
              paused
            </Typography>
          ) : null}
        </Stack>

        <Stack
          direction="row"
          spacing={2.5}
          sx={{
            alignItems: "baseline",
            justifyContent: { xs: "space-between", sm: "flex-end" },
            flexShrink: 0,
          }}
        >
          <BotStat label="Bankroll">
            {bot.activeBankrollCents === null
              ? "unavailable"
              : formatCents(bot.activeBankrollCents)}
          </BotStat>
          <BotStat label="Net P&L" tone={netTone}>
            {bot.netPnlCents === null
              ? "—"
              : formatCents(bot.netPnlCents, true)}
          </BotStat>
          <BotStat label="Return" tone={netTone}>
            {bot.returnPct === null
              ? "—"
              : `${bot.returnPct >= 0 ? "+" : "−"}${Math.abs(bot.returnPct).toFixed(1)}%`}
          </BotStat>
          <BotStat label="Positions">{bot.positionCount}</BotStat>
        </Stack>
      </Stack>
    </Box>
  );
}

function BotStat({
  label,
  tone = "text.primary",
  children,
}: {
  label: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ minWidth: 64, textAlign: { sm: "right" } }}>
      <Typography
        variant="caption"
        sx={{ color: "text.muted", display: "block" }}
      >
        {label}
      </Typography>
      <NumericText size="sm" sx={{ color: tone }}>
        {children}
      </NumericText>
    </Box>
  );
}
