"""Per-game situational context ingest — snaps, injuries, practice status.

This is the highest-leakage-risk data, stored as an append-only observation
stream: one row per (player, game, contextType, knownAt, source). The multi-
observation shape is required because an injury designation progresses over a
week (Questionable Wed -> Out Fri); each observation keeps its own knownAt, so
re-ingesting a later snapshot appends rather than overwriting.

knownAt reconstruction, per source:
  * Snap counts -> the day AFTER the game (reconstructed; post-game facts).
  * Injury / practice status -> the day-before-kickoff injury-report window
    (reconstructed; SIG-82). nflverse removed the feed's ``date_modified``
    publication timestamp in 2025+, so the observed time is no longer available
    and injury known_at falls back to the documented conservative pre-game bound
    (``injury_report_knownat``) — a *later* bound than the real publication, the
    leak-safe direction.

Missingness stays explicit: a season a source does not cover gets a
SourceCoverage row, never a zero-filled or back-filled value.
"""

from __future__ import annotations

from collections.abc import Callable

import polars as pl

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ._common import (
    day_after_game_knownat,
    game_id,
    injury_report_knownat,
    player_id,
    require_columns,
    season_range,
    to_decimal,
)
from .nfl_sources import fetch_injuries, fetch_players, fetch_snap_counts

_SNAP_REQUIRED = [
    "game_id", "season", "pfr_player_id", "team",
    "offense_snaps", "offense_pct", "defense_snaps", "defense_pct", "st_pct",
]
_INJ_REQUIRED = ["season", "week", "team", "gsis_id", "report_status", "practice_status"]

# (contextType, snap_counts column) — numeric observations.
_SNAP_OBS = [
    ("snap_count_offense", "offense_snaps"),
    ("snap_pct_offense", "offense_pct"),
    ("snap_count_defense", "defense_snaps"),
    ("snap_pct_defense", "defense_pct"),
    ("snap_pct_st", "st_pct"),
]

_INSERT_COLS = """
insert into player_game_context (
    id, player_id, game_id, team_abbr_at_game, context_type,
    numeric_value, text_value, valid_at, known_at, known_at_reconstructed,
    source, ingest_run_id, created_at
) values (
    gen_random_uuid(), %(player_id)s, %(game_id)s, %(team)s, %(context_type)s,
    %(numeric_value)s, %(text_value)s, %(valid_at)s, %(known_at)s,
    %(reconstructed)s, 'nflverse', %(run_id)s, now()
)
"""

# Snaps are immutable post-game facts, keyed by an observed-day known_at:
# re-ingest is a pure no-op.
_INSERT_SNAP = _INSERT_COLS + (
    "on conflict (player_id, game_id, context_type, known_at, source) do nothing"
)

# Injury/practice designations lost their observed timestamp (SIG-82), so all of
# a week's snapshots now collapse onto one reconstructed known_at. That makes the
# row a CURRENT-weekly-designation fact rather than an append-only observation:
# a later cycle that sees the status advance (Questionable -> Out) must win, or
# the model's is_available would read a stale early-week designation. The WHERE
# keeps it idempotent — an unchanged re-ingest still writes nothing.
_INSERT_INJURY = _INSERT_COLS + (
    "on conflict (player_id, game_id, context_type, known_at, source) "
    "do update set text_value = excluded.text_value, "
    "ingest_run_id = excluded.ingest_run_id "
    "where player_game_context.text_value is distinct from excluded.text_value"
)

_INJURY_CONTEXT_TYPES = frozenset({"injury_designation", "practice_status"})


def _pfr_crosswalk(fetch: Callable[[], pl.DataFrame]) -> dict[str, str]:
    df = fetch()
    require_columns(df, ["pfr_id", "gsis_id"], dataset="context(players crosswalk)")
    return {
        row["pfr_id"]: player_id(row["gsis_id"])
        for row in df.iter_rows(named=True)
        if row["gsis_id"] and row["pfr_id"]
    }


def _game_maps(cur) -> tuple[dict[str, object], dict[tuple[int, int, str], tuple[str, object]]]:
    cur.execute("select id, kickoff_at from games")
    kickoffs = {gid: kickoff for gid, kickoff in cur.fetchall()}
    cur.execute(
        "select g.season, g.week, ht.nflverse_abbr, at.nflverse_abbr, g.id, g.kickoff_at "
        "from games g "
        "join teams ht on g.home_team_id = ht.id "
        "join teams at on g.away_team_id = at.id"
    )
    by_swt: dict[tuple[int, int, str], tuple[str, object]] = {}
    for season, week, home, away, gid, kickoff in cur.fetchall():
        by_swt[(season, week, home)] = (gid, kickoff)
        by_swt[(season, week, away)] = (gid, kickoff)
    return kickoffs, by_swt


def _snap_rows(df, pfr_to_pid, kickoffs, run_id) -> tuple[list[dict], set[str], int]:
    rows: list[dict] = []
    present: set[str] = set()
    skipped = 0
    for r in df.iter_rows(named=True):
        gid = game_id(r["game_id"])
        kickoff = kickoffs.get(gid)
        pid = pfr_to_pid.get(r["pfr_player_id"])
        if kickoff is None or pid is None:
            skipped += 1
            continue
        present.add(gid)
        known = day_after_game_knownat(kickoff)
        for context_type, col in _SNAP_OBS:
            value = to_decimal(r[col], places=3) if col.endswith("pct") else to_decimal(r[col], places=0)
            if value is None:
                continue
            rows.append({
                "player_id": pid, "game_id": gid, "team": r["team"],
                "context_type": context_type, "numeric_value": value, "text_value": None,
                "valid_at": kickoff, "known_at": known, "reconstructed": True, "run_id": run_id,
            })
    return rows, present, skipped


def _injury_rows(df, by_swt, run_id) -> tuple[list[dict], set[str], int]:
    rows: list[dict] = []
    present: set[str] = set()
    skipped = 0
    for r in df.iter_rows(named=True):
        gsis = r["gsis_id"]
        game = by_swt.get((r["season"], r["week"], r["team"]))
        if not gsis or game is None:
            skipped += 1
            continue
        gid, kickoff = game
        pid = player_id(gsis)
        present.add(gid)
        # nflverse removed the observed publication time (date_modified) in 2025+
        # (SIG-82), so injury/practice known_at is now RECONSTRUCTED to the
        # conservative day-before-kickoff report window — a later (leak-safe)
        # bound. valid_at == known_at here (the designation is a statement made at
        # that report time), which also satisfies the known_at >= valid_at CHECK.
        known = injury_report_knownat(kickoff)
        for context_type, value in (
            ("injury_designation", r["report_status"]),
            ("practice_status", r["practice_status"]),
        ):
            if not value:
                continue
            rows.append({
                "player_id": pid, "game_id": gid, "team": r["team"],
                "context_type": context_type, "numeric_value": None, "text_value": value,
                "valid_at": known, "known_at": known, "reconstructed": True, "run_id": run_id,
            })
    return rows, present, skipped


def _write(cur, rows: list[dict], present: set[str]) -> int:
    game_list = list(present)
    cur.execute(
        "select count(*) from player_game_context where game_id = any(%s)", (game_list,)
    )
    before = cur.fetchone()[0]
    # Snaps append (immutable); injuries upsert the latest designation.
    snap_rows = [r for r in rows if r["context_type"] not in _INJURY_CONTEXT_TYPES]
    injury_rows = [r for r in rows if r["context_type"] in _INJURY_CONTEXT_TYPES]
    if snap_rows:
        cur.executemany(_INSERT_SNAP, snap_rows)
    if injury_rows:
        cur.executemany(_INSERT_INJURY, injury_rows)
    cur.execute(
        "select count(*) from player_game_context where game_id = any(%s)", (game_list,)
    )
    return cur.fetchone()[0] - before


_COVERAGE_UPSERT = """
insert into source_coverage (id, source, dataset, season, coverage, note, updated_at)
values (gen_random_uuid(), 'nflverse', %(dataset)s, %(season)s, %(coverage)s, %(note)s, now())
on conflict (source, dataset, season)
do update set coverage = excluded.coverage, note = excluded.note, updated_at = now()
"""


def _record_coverage(cur, dataset: str, seasons: list[int], seasons_with_data: set[int]) -> None:
    """Explicit missingness ledger: full where the source covered the season, none otherwise."""
    for season in seasons:
        present = season in seasons_with_data
        cur.execute(_COVERAGE_UPSERT, {
            "dataset": dataset, "season": season,
            "coverage": "full" if present else "none",
            "note": None if present else f"no {dataset} coverage upstream for {season}",
        })


def ingest_context(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    fetch_snaps: Callable[[list[int]], pl.DataFrame] = fetch_snap_counts,
    fetch_inj: Callable[[list[int]], pl.DataFrame] = fetch_injuries,
    fetch_players_crosswalk: Callable[[], pl.DataFrame] = fetch_players,
    **_: object,
) -> None:
    seasons = season_range(season_from, season_to)

    snaps_df = fetch_snaps(seasons)
    inj_df = fetch_inj(seasons)
    require_columns(snaps_df, _SNAP_REQUIRED, dataset="context(snaps)")
    require_columns(inj_df, _INJ_REQUIRED, dataset="context(injuries)")

    pfr_to_pid = _pfr_crosswalk(fetch_players_crosswalk)

    written = skipped = 0
    with connect() as conn:
        with conn.cursor() as cur:
            kickoffs, by_swt = _game_maps(cur)

            snap_rows, snap_games, snap_skip = _snap_rows(snaps_df, pfr_to_pid, kickoffs, handle.run_id)
            inj_rows, inj_games, inj_skip = _injury_rows(inj_df, by_swt, handle.run_id)

            written += _write(cur, snap_rows, snap_games)
            written += _write(cur, inj_rows, inj_games)
            skipped = snap_skip + inj_skip

            _record_coverage(cur, "snap_counts", seasons, set(snaps_df["season"].unique().to_list()))
            _record_coverage(cur, "injuries", seasons, set(inj_df["season"].unique().to_list()))
        conn.commit()

    handle.rows_written = written
    if skipped:
        handle.mark_partial(f"{skipped} context observations skipped (player/game not in corpus)")


register(Dataset(name="context", source="nflverse", run=ingest_context))
