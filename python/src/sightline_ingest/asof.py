"""The as-of query layer — the single sanctioned model-facing read path.

``AsOfCorpus`` is bound once to an explicit ``information_cutoff``. Every read
constrains ``known_at <= cutoff`` **in the SQL itself**, so a row that became
known after the cutoff is structurally unreachable — absent from the result set,
never returned and filtered afterward. There is deliberately no method that reads
a fact table without applying the bound cutoff.

Feature computation (Pitch 2 onward) consumes this class and inherits leakage
safety without adding its own date filters. Corrected actuals are walled off:
this layer returns the value **as published at the cutoff** (rolling back any
correction whose availability postdates the cutoff); the corrected value is
reachable only through the separate, grading-only read in ``grading.py``, which
feature code must never import.
"""

from __future__ import annotations

import math
from datetime import datetime

import polars as pl

from .datasets._common import to_decimal, to_int
from .datasets.stats import STAT_COLUMNS
from .db import ConnectionFactory
from .stadiums import STADIUM_COORDS

# Stat columns in canonical order, with their kinds — single source of truth
# is the ingest side (datasets/stats.py), so the two cannot drift.
_STAT_COLS = [c for c, _, _ in STAT_COLUMNS]
_STAT_KINDS = {c: kind for c, _, kind in STAT_COLUMNS}

# SQL twin of datasets._common.day_after_game_knownat: post-game facts
# (final stat lines, play-by-play, snap counts) publish at 09:00 US/Eastern
# the day after the game's EASTERN calendar day. kickoff_at stores naive UTC,
# so convert to the Eastern wall clock, take the next calendar day at 09:00,
# and convert back. The leakage suite asserts this expression and the Python
# function agree at the sharp edges (late Saturday games, SNF, DST).
#
# Why not filter on pgs.known_at directly: a stat correction bumps the current
# row's known_at to the correction time (its version's availability), which
# would wrongly hide a game whose ORIGINAL line was published before the
# cutoff. Original publication is derived from kickoff, exactly like ingest
# derives it.
_PUBLISHED_BY_SQL = (
    "((((g.kickoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date"
    " + interval '1 day 9 hours') AT TIME ZONE 'America/New_York' AT TIME ZONE 'UTC')"
)


def _rows_to_df(cur) -> pl.DataFrame:
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    if not rows:
        # An empty result still carries its column names. A bare pl.DataFrame([])
        # has no schema at all, which turns "this player had no eligible
        # history" into an AttributeError three call frames away instead of an
        # empty frame the caller can reason about.
        return pl.DataFrame({c: [] for c in cols})
    return pl.DataFrame([dict(zip(cols, r)) for r in rows], orient="row")


# ---------------------------------------------------------------------------
# SQL templates shared by the single-row and batched reads.
#
# The batched variants exist because a multi-season backtest issues one read per
# candidate, and per-candidate round trips do not finish in tolerable time. They
# are NOT a second implementation: each template is filled in with a different
# player predicate and ordering, so the cutoff bound, the publication-time
# expression, and the correction roll-back are literally the same SQL text on
# both paths. A copy would drift on the first edit, and the direction it drifts
# is the one that leaks.
# ---------------------------------------------------------------------------

_TRAILING_SQL = f"""
    select {{extra_select}}pgs.game_id, g.kickoff_at, pgs.team_abbr_at_game,
           {", ".join(f"pgs.{c}" for c in _STAT_COLS)},
           (select c.prior_values from player_game_stat_corrections c
            where c.player_game_stat_id = pgs.id
              and c.correction_known_at > %(cutoff)s
            order by c.correction_known_at asc limit 1) as rollback_values
    from player_game_stats pgs
    join games g on g.id = pgs.game_id
    join games tg on tg.id = %(before)s
    where {{player_predicate}}
      and g.kickoff_at < tg.kickoff_at
      and {_PUBLISHED_BY_SQL} <= %(cutoff)s
    order by {{order_by}}
"""

_CONTEXT_SQL = """
    select {extra_select}context_type, numeric_value, text_value, known_at,
           known_at_reconstructed
    from player_game_context
    where {player_predicate} and game_id = %(gid)s
      and context_type = %(ctype)s and known_at <= %(cutoff)s
    order by {order_by}
"""

# Previous eligible game per player, in one pass. DISTINCT ON is the Postgres
# idiom for "latest row per group" and needs the leading ORDER BY column to
# match the grouping key.
_PREV_GAME_SQL = f"""
    select distinct on (pgs.player_id)
           pgs.player_id, g.kickoff_at, ht.nflverse_abbr
    from player_game_stats pgs
    join games g on g.id = pgs.game_id
    join teams ht on g.home_team_id = ht.id
    where pgs.player_id = any(%(pids)s::text[])
      and g.id <> %(gid)s
      and g.kickoff_at < %(target_kick)s
      and {_PUBLISHED_BY_SQL} <= %(cutoff)s
    order by pgs.player_id, g.kickoff_at desc
"""


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(h)), 1)


def _apply_rollbacks(cur) -> pl.DataFrame:
    """Materialise trailing-stat rows, rolling back post-cutoff corrections.

    Shared by the single-row and batched trailing reads, so a correction can
    never be honoured on one path and missed on the other.
    """
    cols = [d[0] for d in cur.description]
    rows = []
    for raw in cur.fetchall():
        row = dict(zip(cols, raw))
        rollback = row.pop("rollback_values")
        if rollback is not None:
            # A correction landed after the cutoff: use the value that was
            # current at the cutoff, not the corrected one. prior_values
            # round-trips through JSON (Decimals become floats), so coerce
            # back to the column kinds ingest writes — a frame must not mix
            # dtypes depending on whether a rollback applied.
            for c in _STAT_COLS:
                if c in rollback:
                    v = rollback[c]
                    row[c] = to_decimal(v) if _STAT_KINDS[c] == "decimal" else to_int(v)
        rows.append(row)
    if not rows:
        return pl.DataFrame({c: [] for c in cols if c != "rollback_values"})
    return pl.DataFrame(rows, orient="row")


def _rest_and_travel_from(
    target_kick, target_home: str | None, prev_kick, prev_home: str | None
) -> dict:
    """The derivation itself, shared by the single-row and batched paths."""
    if target_home is None or prev_kick is None:
        return {"rest_days": None, "travel_km": None}
    rest_days = (target_kick.date() - prev_kick.date()).days
    travel_km = None
    if target_home in STADIUM_COORDS and prev_home in STADIUM_COORDS:
        travel_km = _haversine_km(STADIUM_COORDS[prev_home], STADIUM_COORDS[target_home])
    return {"rest_days": rest_days, "travel_km": travel_km}


class AsOfCorpus:
    """The only sanctioned model-facing read path over the corpus.

    Bound to a single information cutoff; every read excludes rows with
    ``known_at > cutoff`` structurally.
    """

    def __init__(self, connect: ConnectionFactory, cutoff: datetime) -> None:
        self._connect = connect
        self._cutoff = cutoff

    @property
    def cutoff(self) -> datetime:
        return self._cutoff

    # --- Context ----------------------------------------------------------

    def player_context(self, *, player_id: str, game_id: str, context_type: str) -> pl.DataFrame:
        """All observations of a context type known as of the cutoff (asc by knownAt)."""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                _CONTEXT_SQL.format(
                    extra_select="",
                    player_predicate="player_id = %(pid)s",
                    order_by="known_at",
                ),
                {"pid": player_id, "gid": game_id, "ctype": context_type, "cutoff": self._cutoff},
            )
            return _rows_to_df(cur)

    def player_context_batch(
        self, *, player_ids: list[str], game_id: str, context_type: str
    ) -> pl.DataFrame:
        """``player_context`` for many players in one round trip.

        Same SQL, same cutoff bound; ``player_id`` is added to the projection
        and to the ordering so the caller can group without assuming the input
        order was preserved.
        """
        # No empty-input special case: an empty array simply matches nothing.
        # The ::text[] cast is required because Postgres cannot infer the
        # element type of an empty parameterised array.
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                _CONTEXT_SQL.format(
                    extra_select="player_id, ",
                    player_predicate="player_id = any(%(pids)s::text[])",
                    order_by="player_id, known_at",
                ),
                {
                    "pids": list(player_ids), "gid": game_id,
                    "ctype": context_type, "cutoff": self._cutoff,
                },
            )
            return _rows_to_df(cur)

    def latest_injury_designation(self, *, player_id: str, game_id: str) -> str | None:
        """The most recently KNOWN designation as of the cutoff.

        Honours the Wed->Fri progression: a Friday-evening 'Out' known after a
        Friday-morning cutoff is unreachable; the Wednesday 'Questionable' is
        returned instead.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select text_value from player_game_context "
                "where player_id = %(pid)s and game_id = %(gid)s "
                "and context_type = 'injury_designation' and known_at <= %(cutoff)s "
                "order by known_at desc limit 1",
                {"pid": player_id, "gid": game_id, "cutoff": self._cutoff},
            )
            row = cur.fetchone()
            return row[0] if row else None

    # --- Schedule & weather ----------------------------------------------

    def schedule_as_known(self, *, game_id: str) -> pl.DataFrame:
        """The kickoff/venue/status that was known as of the cutoff (latest revision)."""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select kickoff_at, venue, status, known_at "
                "from game_schedule_revisions "
                "where game_id = %(gid)s and known_at <= %(cutoff)s "
                "order by known_at desc limit 1",
                {"gid": game_id, "cutoff": self._cutoff},
            )
            return _rows_to_df(cur)

    def game_weather(self, *, game_id: str) -> pl.DataFrame:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select temperature_c, wind_kph, precipitation_mm, era, status, "
                "weather_source, known_at "
                "from game_weather where game_id = %(gid)s and known_at <= %(cutoff)s",
                {"gid": game_id, "cutoff": self._cutoff},
            )
            return _rows_to_df(cur)

    # --- Trailing stats (with correction roll-back) ----------------------

    def trailing_player_stats(self, *, player_id: str, before_game_id: str) -> pl.DataFrame:
        """The player's prior-game stat lines, valued AS PUBLISHED AT THE CUTOFF.

        Included only if the game kicked off before the target game AND its stats
        were first published (09:00 ET the day after the game) by the cutoff — so
        a future game can never contribute to a trailing aggregate. Any correction
        whose availability postdates the cutoff is rolled back to the value that
        was current at the cutoff, so a corrected actual cannot re-enter features.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                _TRAILING_SQL.format(
                    extra_select="",
                    player_predicate="pgs.player_id = %(pid)s",
                    order_by="g.kickoff_at",
                ),
                {"pid": player_id, "before": before_game_id, "cutoff": self._cutoff},
            )
            return _apply_rollbacks(cur)

    def trailing_player_stats_batch(
        self, *, player_ids: list[str], before_game_id: str
    ) -> pl.DataFrame:
        """``trailing_player_stats`` for many players in one round trip.

        The harness reads once per (game, cutoff) for every candidate player in
        that game rather than once per candidate. Identical SQL, identical
        cutoff bound, identical correction roll-back — the only differences are
        the player predicate, ``player_id`` in the projection, and
        ``player_id`` leading the ordering.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                _TRAILING_SQL.format(
                    extra_select="pgs.player_id, ",
                    player_predicate="pgs.player_id = any(%(pids)s::text[])",
                    order_by="pgs.player_id, g.kickoff_at",
                ),
                {
                    "pids": list(player_ids),
                    "before": before_game_id,
                    "cutoff": self._cutoff,
                },
            )
            return _apply_rollbacks(cur)

    def population_stats(
        self, *, before_season: int, position: str, column: str
    ) -> pl.DataFrame:
        """Population evidence for fitting a prior, from earlier seasons only.

        Two bounds, both required. ``season < before_season`` is what makes a
        prior walk-forward: a prior that saw its own season would encode that
        season's outcomes into every prediction inside it. The publication-time
        bound is the same one every other read here carries, so a prior fitted
        mid-run cannot see a game the model itself could not.

        ``column`` is chosen from the stat registry, never from user input; it
        is interpolated because a column name cannot be a bind parameter.
        """
        if column not in _STAT_COLS:
            raise ValueError(f"unknown stat column: {column!r}")
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                select g.season, pgs.player_id, pgs.{column} as value
                from player_game_stats pgs
                join games g on g.id = pgs.game_id
                join players p on p.id = pgs.player_id
                where g.season < %(season)s
                  and p.position = %(position)s
                  and pgs.{column} is not null
                  and {_PUBLISHED_BY_SQL} <= %(cutoff)s
                order by g.season, pgs.player_id, pgs.game_id
                """,
                {
                    "season": before_season, "position": position,
                    "cutoff": self._cutoff,
                },
            )
            return _rows_to_df(cur)

    def season_participants(
        self, *, seasons: tuple[int, ...], column: str
    ) -> pl.DataFrame:
        """Players with a published stat line for ``column`` in ``seasons``.

        The harness's candidate universe, derived from **pre-cutoff
        information only**. Enumerating candidates from the target game's own
        participants would condition the population on an outcome.

        The caller passes the current season AND the one before it. Restricting
        to the current season alone would leave week 1 with no candidates at
        all — nothing has published yet — so the harness would silently skip
        the first week of every season, and a coverage gap that produces no
        rows produces no exclusions either, which is the kind of absence
        nobody notices.
        """
        if column not in _STAT_COLS:
            raise ValueError(f"unknown stat column: {column!r}")
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                select distinct pgs.player_id, p.position
                from player_game_stats pgs
                join games g on g.id = pgs.game_id
                join players p on p.id = pgs.player_id
                where g.season = any(%(seasons)s::int[])
                  and pgs.{column} is not null
                  and {_PUBLISHED_BY_SQL} <= %(cutoff)s
                order by pgs.player_id
                """,
                {"seasons": list(seasons), "cutoff": self._cutoff},
            )
            return _rows_to_df(cur)

    # --- Derived on read --------------------------------------------------

    def rest_and_travel(self, *, player_id: str, game_id: str) -> dict:
        """Rest days and travel km INTO the target game, derived on read.

        Never a stored column. The target game's kickoff comes from
        ``schedule_as_known`` — the revision stream at the cutoff, never the
        mutable ``games`` row — so a flex or relocation announced after the
        cutoff cannot change the value retroactively. The previous game is the
        player's latest game whose stat line had been published by the cutoff
        (which also proves the game itself was in the past).
        """
        sched = self.schedule_as_known(game_id=game_id)
        if sched.height == 0:
            # No schedule revision was known at the cutoff: the game did not
            # exist yet from this vantage point. Nothing to derive.
            return {"rest_days": None, "travel_km": None}
        target_kick = sched["kickoff_at"][0]

        with self._connect() as conn, conn.cursor() as cur:
            # Home team of the target game: participants are immutable.
            cur.execute(
                "select ht.nflverse_abbr from games g "
                "join teams ht on g.home_team_id = ht.id where g.id = %(gid)s",
                {"gid": game_id},
            )
            target_row = cur.fetchone()

            cur.execute(
                f"""
                select g.kickoff_at, ht.nflverse_abbr
                from player_game_stats pgs
                join games g on g.id = pgs.game_id
                join teams ht on g.home_team_id = ht.id
                where pgs.player_id = %(pid)s
                  and g.id <> %(gid)s
                  and g.kickoff_at < %(target_kick)s
                  and {_PUBLISHED_BY_SQL} <= %(cutoff)s
                order by g.kickoff_at desc limit 1
                """,
                {
                    "pid": player_id, "gid": game_id,
                    "target_kick": target_kick, "cutoff": self._cutoff,
                },
            )
            prev = cur.fetchone()

        if target_row is None or prev is None:
            return {"rest_days": None, "travel_km": None}
        prev_kick, prev_home = prev
        return _rest_and_travel_from(target_kick, target_row[0], prev_kick, prev_home)

    def rest_and_travel_batch(
        self, *, player_ids: list[str], game_id: str
    ) -> pl.DataFrame:
        """``rest_and_travel`` for many players in one round trip.

        Returns one row per requested player — including players with no
        eligible previous game, whose values are null. Dropping them would make
        the caller unable to distinguish "no prior game" from "player absent
        from the batch", and those are different facts.
        """
        empty = pl.DataFrame(
            {"player_id": list(player_ids),
             "rest_days": [None] * len(player_ids),
             "travel_km": [None] * len(player_ids)},
            schema={"player_id": pl.String, "rest_days": pl.Int64,
                    "travel_km": pl.Float64},
        )

        sched = self.schedule_as_known(game_id=game_id)
        if sched.height == 0:
            # The game did not exist yet from this vantage point.
            return empty
        target_kick = sched["kickoff_at"][0]

        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select ht.nflverse_abbr from games g "
                "join teams ht on g.home_team_id = ht.id where g.id = %(gid)s",
                {"gid": game_id},
            )
            target_row = cur.fetchone()
            if target_row is None:
                return empty

            cur.execute(
                _PREV_GAME_SQL,
                {
                    "pids": list(player_ids), "gid": game_id,
                    "target_kick": target_kick, "cutoff": self._cutoff,
                },
            )
            previous = {pid: (kick, home) for pid, kick, home in cur.fetchall()}

        derived = [
            _rest_and_travel_from(target_kick, target_row[0], *previous.get(pid, (None, None)))
            for pid in player_ids
        ]
        return pl.DataFrame(
            {
                "player_id": list(player_ids),
                "rest_days": [d["rest_days"] for d in derived],
                "travel_km": [d["travel_km"] for d in derived],
            },
            schema={"player_id": pl.String, "rest_days": pl.Int64,
                    "travel_km": pl.Float64},
        )
