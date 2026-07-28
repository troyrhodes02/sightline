"""Grading-oriented reads — the corrected-actuals path, walled off from features.

This module returns the CURRENT (corrected) stat line, with no information
cutoff, for grading a projection after settlement (Pitch 6). It is deliberately
NOT part of ``AsOfCorpus`` and must never be reached from feature computation for
the game it corrects: doing so would let a correction that postdates a game leak
back into the features that predicted it.

Feature/modelling code must not import this module. ``asof.py`` does not.
"""

from __future__ import annotations

import polars as pl

from .db import ConnectionFactory

_STAT_COLS = [
    "passing_yards", "passing_tds", "passing_attempts", "completions",
    "interceptions", "rushing_yards", "rushing_tds", "carries",
    "receiving_yards", "receiving_tds", "receptions", "targets",
]


class GradingCorpus:
    """Corrected-actuals reads for grading. Not leakage-constrained by design."""

    def __init__(self, connect: ConnectionFactory) -> None:
        self._connect = connect

    def final_player_stat(self, *, player_id: str, game_id: str) -> pl.DataFrame:
        """The best-known (fully corrected) stat line for a player-game."""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"select game_id, version, known_at, {', '.join(_STAT_COLS)} "
                "from player_game_stats "
                "where player_id = %(pid)s and game_id = %(gid)s",
                {"pid": player_id, "gid": game_id},
            )
            cols = [d[0] for d in cur.description]
            return pl.DataFrame([dict(zip(cols, r)) for r in cur.fetchall()], orient="row")

    def final_player_stats_for_game(self, *, game_id: str) -> pl.DataFrame:
        """Every player's corrected stat line for one game, in one read.

        The harness grades a whole game at a time. Still grading-only: the
        feature-path modules are swept for any reference to this module
        (test_verify: feature code cannot reach the grading corpus), so a
        future import shows up as a failing guard, not a silent leak.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"select player_id, version, {', '.join(_STAT_COLS)} "
                "from player_game_stats where game_id = %(gid)s "
                "order by player_id",
                {"gid": game_id},
            )
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            if not rows:
                return pl.DataFrame({c: [] for c in cols})
            return pl.DataFrame([dict(zip(cols, r)) for r in rows], orient="row")
