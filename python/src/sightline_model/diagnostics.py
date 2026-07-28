"""Display-only reads for ``sightline-backtest explain``.

**This module deliberately reads rows the model could not see.** That is the
entire point of the excluded-by-cutoff panel: showing the operator what existed
in the corpus and was structurally unreachable at the cutoff is how a leakage
guarantee stops being an assertion and becomes something you can look at.

Which is exactly why it is not part of ``AsOfCorpus`` and never will be. The
as-of layer's contract is that no reachable method returns a row past the
cutoff; a diagnostic that did so from inside it would make that contract
false in the one place people go to check it.

**Feature code must never import this module.** The import-graph test does not
know about it, so this docstring and code review are the guard — treat an
import from ``features.py`` or ``projection.py`` as review-blocking.
"""

from __future__ import annotations

from datetime import datetime

from sightline_ingest.db import ConnectionFactory

# Enough rows to show a pattern, few enough to read in a terminal.
EXCLUDED_SAMPLE = 10


def eligible_sources(
    connect: ConnectionFactory, *, player_id: str, game_id: str, cutoff: datetime
) -> list[dict]:
    """The latest record per source that WAS visible at the cutoff.

    Bounded by the cutoff exactly as the model's own reads are — this half of
    the panel shows what the projection could actually see.
    """
    rows: list[dict] = []
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select context_type, text_value, numeric_value, known_at, "
            "known_at_reconstructed from player_game_context "
            "where player_id = %(pid)s and game_id = %(gid)s "
            "and known_at <= %(cutoff)s "
            "order by context_type, known_at desc",
            {"pid": player_id, "gid": game_id, "cutoff": cutoff},
        )
        seen: set[str] = set()
        for context_type, text, numeric, known_at, reconstructed in cur.fetchall():
            if context_type in seen:
                continue
            seen.add(context_type)
            rows.append({
                "source": context_type,
                "value": text if text is not None else numeric,
                "known_at": known_at,
                "reconstructed": reconstructed,
            })

        cur.execute(
            "select temperature_c, wind_kph, era, status, known_at, "
            "known_at_reconstructed from game_weather "
            "where game_id = %(gid)s and known_at <= %(cutoff)s",
            {"gid": game_id, "cutoff": cutoff},
        )
        weather = cur.fetchone()
        if weather:
            temp, wind, era, status, known_at, reconstructed = weather
            rows.append({
                "source": "weather",
                "value": f"{temp}C {wind}kph ({era}/{status})",
                "known_at": known_at,
                "reconstructed": reconstructed,
            })
    return rows


def excluded_by_cutoff(
    connect: ConnectionFactory, *, player_id: str, game_id: str, cutoff: datetime
) -> list[dict]:
    """Rows that exist in the corpus and were unreachable at the cutoff.

    Their presence here is the point. An empty list is informative too — it
    means there was nothing after the cutoff to be blocked, not that the
    blocking works.
    """
    rows: list[dict] = []
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select 'player_game_stat' as kind, g.season, g.week,
                   pgs.receiving_yards, pgs.rushing_yards, pgs.passing_yards,
                   pgs.known_at
            from player_game_stats pgs
            join games g on g.id = pgs.game_id
            where pgs.player_id = %(pid)s and pgs.known_at > %(cutoff)s
            order by pgs.known_at
            limit %(limit)s
            """,
            {"pid": player_id, "cutoff": cutoff, "limit": EXCLUDED_SAMPLE},
        )
        for kind, season, week, rec, rush, pas, known_at in cur.fetchall():
            value = next(
                (f"{name} {v}" for name, v in
                 (("rec_yds", rec), ("rush_yds", rush), ("pass_yds", pas))
                 if v is not None),
                "—",
            )
            rows.append({
                "kind": kind,
                "detail": f"{season} wk{week:02d} {value}",
                "known_at": known_at,
            })

        remaining = EXCLUDED_SAMPLE - len(rows)
        if remaining > 0:
            cur.execute(
                """
                select 'player_context' as kind, g.season, g.week,
                       pgc.context_type, pgc.text_value, pgc.numeric_value,
                       pgc.known_at
                from player_game_context pgc
                join games g on g.id = pgc.game_id
                where pgc.player_id = %(pid)s and pgc.known_at > %(cutoff)s
                order by pgc.known_at
                limit %(limit)s
                """,
                {"pid": player_id, "cutoff": cutoff, "limit": remaining},
            )
            for kind, season, week, ctype, text, numeric, known_at in cur.fetchall():
                rows.append({
                    "kind": kind,
                    "detail": f"{season} wk{week:02d} {ctype} "
                              f"{text if text is not None else numeric}",
                    "known_at": known_at,
                })
    return rows
