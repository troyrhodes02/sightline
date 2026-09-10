"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { NumericText } from "@/components/primitives/NumericText";
import type { GameGroupDto } from "@/lib/dto/slate";
import { FreshnessLabel } from "./FreshnessLabel";
import { PlayerCard } from "./PlayerCard";
import { formatEtTime } from "./values";

/**
 * A collapsible game group (Screen 1): a header carrying the matchup, kickoff,
 * game-level freshness, and player count, over a stack of one card per player.
 * De-emphasis and caution live in the freshness label (a word, never colour
 * alone); expansion state is local to the session.
 */
export function GameGroup({
  game,
  isAdmin = false,
  defaultExpanded = false,
}: {
  game: GameGroupDto;
  isAdmin?: boolean;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const playerCount = game.players.length;

  return (
    <Box data-game-group sx={{ mb: 2 }}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prior) => !prior)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: "100%",
          textAlign: "left",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          cursor: "pointer",
          font: "inherit",
          color: "inherit",
          px: 2,
          py: 1.25,
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: -2,
          },
        }}
      >
        <ChevronRightIcon
          aria-hidden
          sx={{
            fontSize: 20,
            color: "text.secondary",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 120ms",
          }}
        />
        <Typography
          variant="numericSm"
          sx={{ color: "text.secondary" }}
          suppressHydrationWarning
        >
          {formatEtTime(game.kickoffAt)}
        </Typography>
        <Typography variant="label" sx={{ color: "text.primary" }}>
          {game.awayTeam || "—"} @ {game.homeTeam || "—"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <FreshnessLabel freshness={game.freshness} />
        <NumericText size="sm" muted sx={{ color: "text.secondary" }}>
          {playerCount} {playerCount === 1 ? "player" : "players"}
        </NumericText>
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderTop: "none",
            borderBottomLeftRadius: 6,
            borderBottomRightRadius: 6,
            overflow: "hidden",
          }}
        >
          {game.players.map((card) => (
            <PlayerCard key={card.playerId} card={card} isAdmin={isAdmin} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
