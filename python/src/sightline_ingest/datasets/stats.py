"""Final player box-score ingest with versioned stat corrections.

One current row per (player, game) — the grading target — with typed Decimal
columns (never Float). knownAt reconstructs to the day after the game.
``teamAbbrAtGame`` records the team the player was on THAT game (per-game
context, not current roster).

Corrections: a genuine change in an already-stored player-game bumps
``version``, appends a ``PlayerGameStatCorrection`` preserving the prior value
and the correction's availability, and updates the current row. Re-ingesting an
identical line is an idempotent no-op.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal

import polars as pl
from psycopg.types.json import Json

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import (
    day_after_game_knownat,
    game_id,
    player_id,
    require_columns,
    season_range,
    to_decimal,
    to_int,
)
from .nfl_sources import fetch_player_stats

# (db column, nflverse column, kind). Order is the canonical column order.
STAT_COLUMNS: list[tuple[str, str, str]] = [
    ("passing_yards", "passing_yards", "decimal"),
    ("passing_tds", "passing_tds", "int"),
    ("passing_attempts", "attempts", "int"),
    ("completions", "completions", "int"),
    ("interceptions", "passing_interceptions", "int"),
    ("rushing_yards", "rushing_yards", "decimal"),
    ("rushing_tds", "rushing_tds", "int"),
    ("carries", "carries", "int"),
    ("receiving_yards", "receiving_yards", "decimal"),
    ("receiving_tds", "receiving_tds", "int"),
    ("receptions", "receptions", "int"),
    ("targets", "targets", "int"),
]
_DB_COLS = [c[0] for c in STAT_COLUMNS]
_REQUIRED = ["player_id", "game_id", "team", *[c[1] for c in STAT_COLUMNS]]

# Phase participation (SIG-25). nflverse weekly data reports a numeric 0 for a
# phase a player did not take part in, which the corpus cannot distinguish from
# a genuine zero — a quarterback's 0 receiving_yards is absence, not a
# zero-yard receiving performance. We recover the distinction from the phase's
# own OPPORTUNITY column and, for the phases where a role routinely plays without
# an opportunity, from the player's ROLE combined with cross-phase presence.
#
# The plain opportunity rule (attempts/carries/targets > 0) systematically
# erased a real, informative population: a running back who played and drew no
# targets has a GENUINE 0-target receiving game, and dropping it inflates his
# trailing average by ~22% (measured) — straight into the contract-like segment
# that sizing is fitted against. So the rule adds a role-plausibility clause:
#
#   passing    : attempts > 0
#                (a non-quarterback's 0 pass attempts is genuine absence)
#   rushing    : carries > 0  OR  (position in RB/FB and targets > 0)
#                (a receiving back who played but did not carry — a genuine 0)
#   receiving  : targets > 0  OR  (position in RB/FB/WR/TE and carries > 0)
#                (a skill player demonstrably on the field who drew no target)
#
# Cross-phase presence is deliberately gated on ROLE. Without the role gate a
# quarterback with a carry would flip back into the receiving universe — exactly
# the SIG-25 defect returning. A back with a target does NOT flip a wide
# receiver into the rushing universe, because WR/TE are excluded from the rushing
# clause. Still conservative in the leaking direction: a skill player on the
# field with neither a carry nor a target is left as absence (undercount), never
# invented as a zero. ``position`` is ``players.position`` — the same current-
# roster state the model already accepts as a non-leaking input.
_COL_PHASE: dict[str, str] = {
    "passing_yards": "passing",
    "passing_tds": "passing",
    "passing_attempts": "passing",
    "completions": "passing",
    "interceptions": "passing",
    "rushing_yards": "rushing",
    "rushing_tds": "rushing",
    "carries": "rushing",
    "receiving_yards": "receiving",
    "receiving_tds": "receiving",
    "receptions": "receiving",
    "targets": "receiving",
}
_RUSHING_ROLES = frozenset({"RB", "FB"})
_RECEIVING_ROLES = frozenset({"RB", "FB", "WR", "TE"})

_INSERT = f"""
insert into player_game_stats (
    id, player_id, game_id, team_abbr_at_game,
    {", ".join(_DB_COLS)},
    version, valid_at, known_at, known_at_reconstructed, source,
    ingest_run_id, created_at, updated_at
) values (
    gen_random_uuid(), %(player_id)s, %(game_id)s, %(team)s,
    {", ".join(f"%({c})s" for c in _DB_COLS)},
    1, %(valid_at)s, %(known_at)s, true, 'nflverse', %(run_id)s, now(), now()
)
"""

_UPDATE = f"""
update player_game_stats
   set {", ".join(f"{c} = %({c})s" for c in _DB_COLS)},
       version = %(version)s, known_at = %(known_at)s, updated_at = now()
 where id = %(id)s
"""

_INSERT_CORRECTION = """
insert into player_game_stat_corrections (
    id, player_game_stat_id, version, prior_values, corrected_values,
    correction_known_at, source, ingest_run_id, created_at
) values (
    gen_random_uuid(), %(stat_id)s, %(version)s, %(prior)s, %(corrected)s,
    %(correction_known_at)s, 'nflverse', %(run_id)s, now()
)
"""


def _positive(value: object) -> bool:
    """A positive opportunity count. None / NaN / non-positive is not."""
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def _phase_participation(row: dict, position: str | None) -> dict[str, bool]:
    """Per-phase participation, opportunity-or-role. See ``_COL_PHASE``."""
    attempts = _positive(row.get("attempts"))
    carries = _positive(row.get("carries"))
    targets = _positive(row.get("targets"))
    pos = position or ""
    return {
        "passing": attempts,
        "rushing": carries or (pos in _RUSHING_ROLES and targets),
        "receiving": targets or (pos in _RECEIVING_ROLES and carries),
    }


def _stat_values(row: dict, position: str | None) -> dict[str, object]:
    """Typed stat columns, with phase non-participation resolved to NULL.

    A phase the player did not take part in is absence: every column of that
    phase is NULL, not 0. A participant who produced nothing — including a back
    who played and drew no target — keeps a genuine 0. See ``_COL_PHASE``.
    """
    participated = _phase_participation(row, position)
    out: dict[str, object] = {}
    for db_col, src_col, kind in STAT_COLUMNS:
        if not participated[_COL_PHASE[db_col]]:
            out[db_col] = None  # absence, never zero
            continue
        out[db_col] = to_decimal(row[src_col]) if kind == "decimal" else to_int(row[src_col])
    return out


def _jsonable(values: dict[str, object]) -> dict[str, object]:
    return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in values.items()}


def ingest_stats(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch: Callable[[list[int]], pl.DataFrame] = fetch_player_stats,
    correction_known_at: datetime | None = None,
    **_: object,
) -> None:
    seasons = season_range(season_from, season_to)
    df = fetch(seasons)
    require_columns(df, _REQUIRED, dataset="stats")

    # Idempotence guard (SIG-25, was SIG-24): a duplicate (player_id, game_id)
    # within one fetch frame trips the unique constraint on the second INSERT.
    # Collapse to last-wins — the final row for a pair is the one a correction
    # would have us keep — so a re-run over an overlapping window (which the
    # in-season pipeline does by design) is a clean no-op rather than a red run.
    deduped = 0
    if df.height:
        before = df.height
        df = df.unique(subset=["player_id", "game_id"], keep="last", maintain_order=True)
        deduped = before - df.height

    corr_known = correction_known_at or datetime.now(timezone.utc).replace(
        tzinfo=None, microsecond=0
    )

    written = corrected = skipped = 0
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id, kickoff_at from games")
            kickoffs = {gid: k for gid, k in cur.fetchall()}
            # position drives the role-plausibility clause of phase
            # participation (SIG-25); membership doubles as the known-players set.
            cur.execute("select id, position from players")
            positions = {pid: pos for pid, pos in cur.fetchall()}

            for row in df.iter_rows(named=True):
                gsis = row["player_id"]
                if not gsis:
                    skipped += 1
                    continue
                pid = player_id(gsis)
                gid = game_id(row["game_id"])
                kickoff = kickoffs.get(gid)
                if kickoff is None or pid not in positions:
                    skipped += 1  # player/game not in corpus; surfaced, not invented
                    continue
                team = row["team"]
                if not team:
                    # Pre-2002 rows carry no team_abbr_at_game. Skip and count
                    # rather than trip the NOT NULL constraint mid-load; the
                    # 2002 corpus floor is documented in the runbook.
                    skipped += 1
                    continue

                values = _stat_values(row, positions.get(pid))
                cur.execute(
                    f"select id, version, {', '.join(_DB_COLS)} "
                    "from player_game_stats where player_id = %s and game_id = %s",
                    (pid, gid),
                )
                existing = cur.fetchone()

                if existing is None:
                    cur.execute(
                        _INSERT,
                        {
                            "player_id": pid, "game_id": gid, "team": team,
                            "valid_at": kickoff, "known_at": day_after_game_knownat(kickoff),
                            "run_id": handle.run_id, **values,
                        },
                    )
                    written += 1
                    continue

                stat_id, version = existing[0], existing[1]
                stored = dict(zip(_DB_COLS, existing[2:]))
                if stored == values:
                    continue  # idempotent no-op

                # Genuine correction: version the change and preserve the prior line.
                new_version = version + 1
                cur.execute(
                    _INSERT_CORRECTION,
                    {
                        "stat_id": stat_id, "version": new_version,
                        "prior": Json(_jsonable(stored)),
                        "corrected": Json(_jsonable(values)),
                        "correction_known_at": corr_known, "run_id": handle.run_id,
                    },
                )
                cur.execute(
                    _UPDATE,
                    {"id": stat_id, "version": new_version, "known_at": corr_known, **values},
                )
                corrected += 1

        conn.commit()

    handle.rows_written = written
    handle.rows_updated = corrected
    if skipped or deduped:
        handle.mark_partial(
            f"{skipped} stat rows skipped (player/game not in corpus, or missing team); "
            f"{deduped} duplicate (player, game) rows collapsed"
        )


register(Dataset(name="stats", source="nflverse", run=ingest_stats))
