"""Persist current projections for contract-listed players (Pitch 4, SIG-41).

The manual, out-of-band step between the Pitch 2 engine and the application:
``sightline-model project`` computes projections for every player with a
resolved Kalshi contract on an upcoming game and writes them to the
``projections`` / ``projection_drivers`` tables the slate reads. Scheduling
arrives with Pitch 5; until then this command is how a projection set exists.

Boundaries this module is built around:

* **Scope is contract-listed players only** (spec RD-15). The read against
  ``contracts`` selects IDENTITY columns — player, game, stat type — and
  nothing else. This module must never read the price-observation or
  recommendation-snapshot tables: contract identity says WHO to project, and
  a price could only ever say WHAT to predict, which is the second invariant
  broken. The import-graph test enforces this structurally.
* **Every model-facing read goes through the as-of layer** with one explicit
  cutoff for the whole run. ``information_cutoff`` and ``computed_at`` are
  different timestamps and both are stored.
* **Idempotence**: ids are uuid5 of the natural key and the insert is
  ``ON CONFLICT DO NOTHING`` on ``(player, game, stat, model_version,
  information_cutoff)`` — re-running with the same cutoff writes nothing and
  changes nothing. A new cutoff is a new row; the slate reads the freshest.
* **Prisma owns the schema.** This module writes rows; it never migrates.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.db import connect

from .priors import InsufficientPriorEvidence, Prior, fit_prior
from .features import assemble_batch
from .projection import ProjectionResult, Unprojectable, project_one
from .stat_types import spec

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # RFC 4122 URL namespace

# Identity columns only. Adding a price column to this query is the second
# invariant broken — see the module docstring and test_import_graph.
_CANDIDATES_SQL = """
    select distinct c.player_id, c.game_id, c.stat_type
    from contracts c
    join games g on g.id = c.game_id
    where c.resolution_status in ('resolved', 'manual_override')
      and c.player_id is not null
      and c.game_id is not null
      and c.stat_type is not null
      and g.status = 'scheduled'
      and g.kickoff_at > %(now)s
"""

_GAME_SQL = """
    select g.id, g.season, g.kickoff_at,
           ht.nflverse_abbr as home_abbr, at_.nflverse_abbr as away_abbr
    from games g
    join teams ht on ht.id = g.home_team_id
    join teams at_ on at_.id = g.away_team_id
    where g.id = any(%(ids)s)
"""

_INSERT_PROJECTION_SQL = """
    insert into projections (
        id, player_id, game_id, stat_type, model_version, distribution_kind,
        params, quantiles, pmf, projected_value, projected_median,
        interval_low, interval_high, confidence, n_eff,
        computed_at, information_cutoff
    ) values (
        %(id)s, %(player_id)s, %(game_id)s, %(stat_type)s, %(model_version)s,
        %(distribution_kind)s, %(params)s, %(quantiles)s, %(pmf)s,
        %(projected_value)s, %(projected_median)s, %(interval_low)s,
        %(interval_high)s, %(confidence)s, %(n_eff)s,
        %(computed_at)s, %(information_cutoff)s
    )
    on conflict (player_id, game_id, stat_type, model_version, information_cutoff)
    do nothing
"""

_INSERT_DRIVER_SQL = """
    insert into projection_drivers (id, projection_id, rank, text)
    values (%(id)s, %(projection_id)s, %(rank)s, %(text)s)
    on conflict (projection_id, rank) do nothing
"""


def projection_row_id(
    player_id: str, game_id: str, stat_type: str, model_version: str, cutoff: datetime
) -> str:
    """Deterministic id from the persist key, so re-runs collide by design."""
    key = f"sightline:projection:{player_id}:{game_id}:{stat_type}:{model_version}:{cutoff.isoformat()}"
    return str(uuid.uuid5(_NS, key))


def _positions_for(corpus: AsOfCorpus, seasons: tuple[int, int], column: str) -> dict[str, str]:
    frame = corpus.season_participants(seasons=seasons, column=column)
    if frame.height == 0:
        return {}
    return {row["player_id"]: row["position"] for row in frame.to_dicts()}


def run_project(cutoff: datetime, *, now: datetime | None = None) -> dict[str, int]:
    """Compute and persist projections for all contract-listed candidates.

    Returns counters for the summary line. One transaction for the whole run:
    a failure rolls everything back and is reported as a failure, never as a
    partially written projection set presented as complete.
    """
    # The corpus stores naive-UTC timestamps (the runtime-wide convention);
    # normalise both clocks at the boundary so comparisons and stored values
    # share one convention.
    cutoff = _naive_utc(cutoff)
    now = _naive_utc(now) if now else datetime.now(timezone.utc).replace(tzinfo=None)
    totals = {"candidates": 0, "projected": 0, "unprojectable": 0, "skipped_games": 0}

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_CANDIDATES_SQL, {"now": now})
            candidates = cur.fetchall()
            columns = [d.name for d in cur.description]
        triples = [dict(zip(columns, row)) for row in candidates]

        if not triples:
            print("No resolved contracts on upcoming scheduled games; nothing to project.")
            return totals

        game_ids = sorted({t["game_id"] for t in triples})
        with conn.cursor() as cur:
            cur.execute(_GAME_SQL, {"ids": game_ids})
            games = {
                row[0]: dict(zip([d.name for d in cur.description], row))
                for row in cur.fetchall()
            }
            # game_id -> season for the FULL corpus: history rows join through
            # this map, and history reaches back across seasons.
            cur.execute("select id, season from games")
            seasons_by_game = {row[0]: row[1] for row in cur.fetchall()}

        corpus = AsOfCorpus(connect, cutoff)
        prior_cache: dict[tuple[int, str, str], Prior | None] = {}

        by_game_stat: dict[tuple[str, str], list[str]] = {}
        for t in triples:
            by_game_stat.setdefault((t["game_id"], t["stat_type"]), []).append(
                t["player_id"]
            )

        with conn.transaction():
            for (game_id, stat_name), player_ids in sorted(by_game_stat.items()):
                game = games.get(game_id)
                if game is None:
                    totals["skipped_games"] += 1
                    continue
                kickoff = game["kickoff_at"]
                if cutoff >= kickoff:
                    # A cutoff at or past kickoff cannot honestly project this
                    # game. Skipped loudly, never silently projected.
                    print(f"skip {game_id} {stat_name}: cutoff at or after kickoff")
                    totals["skipped_games"] += 1
                    continue

                stat = spec(stat_name)
                positions = _positions_for(
                    corpus, (game["season"] - 1, game["season"]), stat.column
                )
                histories = assemble_batch(
                    corpus,
                    player_ids=sorted(set(player_ids)),
                    game_id=game_id,
                    spec=stat,
                    seasons_by_game=seasons_by_game,
                )

                for player_id in sorted(set(player_ids)):
                    totals["candidates"] += 1
                    history = histories[player_id]
                    position = positions.get(player_id) or "UNK"
                    prior = _prior(corpus, prior_cache, game["season"], stat, position)
                    if prior is None:
                        totals["unprojectable"] += 1
                        print(
                            f"unprojectable {player_id} {stat_name}: "
                            f"no pre-{game['season']} prior for {position}"
                        )
                        continue

                    result = project_one(
                        history,
                        prior=prior,
                        spec=stat,
                        game_id=game_id,
                        kickoff=kickoff,
                        information_cutoff=cutoff,
                        computed_at=now,
                    )
                    if isinstance(result, Unprojectable):
                        totals["unprojectable"] += 1
                        print(
                            f"unprojectable {player_id} {stat_name}: {result.reason}"
                        )
                        continue

                    _persist(conn, result, cutoff=cutoff, computed_at=now)
                    totals["projected"] += 1

    print(
        f"projected {totals['projected']} / {totals['candidates']} candidates "
        f"({totals['unprojectable']} unprojectable, "
        f"{totals['skipped_games']} game-stat groups skipped)"
    )
    return totals


def _prior(
    corpus: AsOfCorpus,
    cache: dict[tuple[int, str, str], Prior | None],
    season: int,
    stat,
    position: str,
) -> Prior | None:
    key = (season, stat.name, position)
    if key in cache:
        return cache[key]
    frame = corpus.population_stats(
        before_season=season, position=position, column=stat.column
    )
    rows = frame.to_dicts() if frame.height else []
    try:
        prior = fit_prior(rows, season=season, spec=stat, position=position)
    except InsufficientPriorEvidence:
        prior = None
    cache[key] = prior
    return prior


def _persist(conn, result: ProjectionResult, *, cutoff: datetime, computed_at: datetime) -> None:
    row_id = projection_row_id(
        result.player_id, result.game_id, result.stat_type,
        result.model_version, cutoff,
    )
    with conn.cursor() as cur:
        cur.execute(
            _INSERT_PROJECTION_SQL,
            {
                "id": row_id,
                "player_id": result.player_id,
                "game_id": result.game_id,
                "stat_type": result.stat_type,
                "model_version": result.model_version,
                "distribution_kind": result.distribution_kind,
                "params": json.dumps(result.params),
                "quantiles": json.dumps(result.quantiles),
                "pmf": json.dumps(result.pmf) if result.pmf is not None else None,
                "projected_value": result.projected_value,
                "projected_median": result.projected_median,
                "interval_low": result.interval_low,
                "interval_high": result.interval_high,
                "confidence": result.confidence,
                "n_eff": result.n_eff,
                "computed_at": computed_at,
                "information_cutoff": cutoff,
            },
        )
        # ON CONFLICT DO NOTHING: an existing row for this key keeps its
        # original computed_at AND its original drivers — the re-run is a
        # no-op, which is what idempotence means here.
        if cur.rowcount == 0:
            return
        for rank, text in enumerate(result.drivers):
            cur.execute(
                _INSERT_DRIVER_SQL,
                {
                    "id": str(uuid.uuid5(_NS, f"sightline:driver:{row_id}:{rank}")),
                    "projection_id": row_id,
                    "rank": rank,
                    "text": text,
                },
            )


def _naive_utc(value: datetime) -> datetime:
    """Aware → UTC-naive; naive is trusted as already-UTC (corpus convention)."""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_cutoff(value: str | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise SystemExit("--cutoff must carry a timezone offset (e.g. ...Z or +00:00)")
    return _naive_utc(parsed)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sightline-model",
        description="Model-side operational commands (projection persistence).",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    project = sub.add_parser(
        "project",
        help="compute and persist projections for contract-listed players",
    )
    project.add_argument(
        "--cutoff",
        default=None,
        help="information cutoff, ISO-8601 with offset (default: now, UTC)",
    )

    args = parser.parse_args(argv)
    if args.command == "project":
        run_project(_parse_cutoff(args.cutoff))
        return 0
    return 2  # pragma: no cover - argparse enforces the subcommand


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
