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
from datetime import datetime, timedelta

import polars as pl

from .db import ConnectionFactory
from .stadiums import STADIUM_COORDS

# Stat columns, in canonical order (mirrors datasets/stats.py).
_STAT_COLS = [
    "passing_yards", "passing_tds", "passing_attempts", "completions",
    "interceptions", "rushing_yards", "rushing_tds", "carries",
    "receiving_yards", "receiving_tds", "receptions", "targets",
]


def _rows_to_df(cur) -> pl.DataFrame:
    cols = [d[0] for d in cur.description]
    return pl.DataFrame([dict(zip(cols, r)) for r in cur.fetchall()], orient="row")


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(h)), 1)


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
                "select context_type, numeric_value, text_value, known_at, "
                "known_at_reconstructed "
                "from player_game_context "
                "where player_id = %(pid)s and game_id = %(gid)s "
                "and context_type = %(ctype)s and known_at <= %(cutoff)s "
                "order by known_at",
                {"pid": player_id, "gid": game_id, "ctype": context_type, "cutoff": self._cutoff},
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
        were first published (day after the game) by the cutoff — so a future
        game can never contribute to a trailing aggregate. Any correction whose
        availability postdates the cutoff is rolled back to the value that was
        current at the cutoff, so a corrected actual cannot re-enter features.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                select pgs.game_id, g.kickoff_at, pgs.team_abbr_at_game,
                       {", ".join(f"pgs.{c}" for c in _STAT_COLS)},
                       (select c.prior_values from player_game_stat_corrections c
                        where c.player_game_stat_id = pgs.id
                          and c.correction_known_at > %(cutoff)s
                        order by c.correction_known_at asc limit 1) as rollback_values
                from player_game_stats pgs
                join games g on g.id = pgs.game_id
                join games tg on tg.id = %(before)s
                where pgs.player_id = %(pid)s
                  and g.kickoff_at < tg.kickoff_at
                  and (date_trunc('day', g.kickoff_at) + interval '1 day') <= %(cutoff)s
                order by g.kickoff_at
                """,
                {"pid": player_id, "before": before_game_id, "cutoff": self._cutoff},
            )
            rows = []
            cols = [d[0] for d in cur.description]
            for raw in cur.fetchall():
                row = dict(zip(cols, raw))
                rollback = row.pop("rollback_values")
                if rollback is not None:
                    # A correction landed after the cutoff: use the value that was
                    # current at the cutoff, not the corrected one.
                    for c in _STAT_COLS:
                        if c in rollback:
                            row[c] = rollback[c]
                rows.append(row)
            return pl.DataFrame(rows, orient="row")

    # --- Derived on read --------------------------------------------------

    def rest_and_travel(self, *, player_id: str, game_id: str) -> dict:
        """Rest days and travel km, derived from schedule facts known at the cutoff.

        Never a stored column. Uses the player's immediately prior game (by
        kickoff) whose schedule was known by the cutoff.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                select g.kickoff_at, ht.nflverse_abbr
                from player_game_stats pgs
                join games g on g.id = pgs.game_id
                join teams ht on g.home_team_id = ht.id
                where pgs.player_id = %(pid)s
                  and (date_trunc('day', g.kickoff_at) + interval '1 day') <= %(cutoff)s
                  and g.kickoff_at <= (select kickoff_at from games where id = %(gid)s)
                order by g.kickoff_at desc limit 2
                """,
                {"pid": player_id, "gid": game_id, "cutoff": self._cutoff},
            )
            games = cur.fetchall()

        if len(games) < 2:
            return {"rest_days": None, "travel_km": None}
        (this_kick, this_home), (prev_kick, prev_home) = games[0], games[1]
        rest_days = (this_kick.date() - prev_kick.date()).days
        travel_km = None
        if this_home in STADIUM_COORDS and prev_home in STADIUM_COORDS:
            travel_km = _haversine_km(STADIUM_COORDS[prev_home], STADIUM_COORDS[this_home])
        return {"rest_days": rest_days, "travel_km": travel_km}
