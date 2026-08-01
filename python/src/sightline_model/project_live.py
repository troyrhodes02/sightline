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
from sightline_ingest.errors import sanitize_error
from sightline_ingest.pipeline import (
    CATEGORY_RECOMPUTE,
    GAME_FAILED,
    GAME_SKIPPED,
    GAME_SUCCEEDED,
    RUN_FAILED,
    RUN_SUCCEEDED,
    SCOPE_GAMEDAY,
    SCOPE_IN_WEEK,
    finish_pipeline_run,
    manual_invocation_id,
    record_pipeline_run_game,
    start_pipeline_run,
)

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


def run_project(
    cutoff: datetime,
    *,
    now: datetime | None = None,
    games: list[str] | None = None,
    invocation_id: str | None = None,
) -> dict[str, int]:
    """Compute and persist projections for contract-listed candidates.

    Returns counters for the summary line. The cycle is recorded as a
    ``PipelineRun`` (category ``recompute``) created ``running`` before any
    work, with per-game outcomes in ``pipeline_run_games`` — one transaction
    PER GAME, so one game failing rolls back and records only itself while the
    rest of the slate still moves (spec RD-P7). A duplicate ``invocation_id``
    records nothing and re-runs nothing.

    ``games`` restricts the run to those game ids (the game-day dispatcher's
    per-kickoff-window scoping); ``None`` means every upcoming
    contract-listed game (the nightly cycle).
    """
    # The corpus stores naive-UTC timestamps (the runtime-wide convention);
    # normalise both clocks at the boundary so comparisons and stored values
    # share one convention.
    cutoff = _naive_utc(cutoff)
    now = _naive_utc(now) if now else datetime.now(timezone.utc).replace(tzinfo=None)
    totals = {
        "candidates": 0,
        "projected": 0,
        "unprojectable": 0,
        "skipped_games": 0,
        "failed_games": 0,
    }

    run_id = start_pipeline_run(
        connect,
        category=CATEGORY_RECOMPUTE,
        invocation_id=invocation_id or manual_invocation_id(),
        scope=SCOPE_GAMEDAY if games else SCOPE_IN_WEEK,
    )
    if run_id is None:
        print(f"project: invocation {invocation_id!r} already recorded; skipping")
        return totals

    try:
        failed_games = _project_all(
            run_id, cutoff=cutoff, now=now, games=games, totals=totals
        )
    except BaseException as exc:
        # Fatal error outside any per-game boundary: the cycle is failed,
        # never left presenting as (or later completing into) a success.
        finish_pipeline_run(
            connect, run_id, status=RUN_FAILED, error_message=sanitize_error(exc)
        )
        raise

    totals["failed_games"] = failed_games
    status = RUN_FAILED if failed_games else RUN_SUCCEEDED
    finish_pipeline_run(
        connect,
        run_id,
        status=status,
        error_message=f"{failed_games} game(s) failed" if failed_games else None,
    )
    print(
        f"projected {totals['projected']} / {totals['candidates']} candidates "
        f"({totals['unprojectable']} unprojectable, "
        f"{totals['skipped_games']} games skipped, {failed_games} games failed)"
    )
    return totals


def _project_all(
    run_id: str,
    *,
    cutoff: datetime,
    now: datetime,
    games: list[str] | None,
    totals: dict[str, int],
) -> int:
    """Project every selected game, one transaction per game. Returns the
    number of failed games."""
    with connect() as conn:
        with conn.cursor() as cur:
            sql = _CANDIDATES_SQL
            params: dict[str, object] = {"now": now}
            if games is not None:
                sql += "      and c.game_id = any(%(game_ids)s)"
                params["game_ids"] = games
            cur.execute(sql, params)
            candidates = cur.fetchall()
            columns = [d.name for d in cur.description]
        triples = [dict(zip(columns, row)) for row in candidates]

        if not triples:
            # Empty success is success: a run that finds nothing to project
            # completed its work (spec: no-new-data success is a valid run).
            print("No resolved contracts on upcoming scheduled games; nothing to project.")
            return 0

        game_ids = sorted({t["game_id"] for t in triples})
        with conn.cursor() as cur:
            cur.execute(_GAME_SQL, {"ids": game_ids})
            games_by_id = {
                row[0]: dict(zip([d.name for d in cur.description], row))
                for row in cur.fetchall()
            }
            # game_id -> season for the FULL corpus: history rows join through
            # this map, and history reaches back across seasons.
            cur.execute("select id, season from games")
            seasons_by_game = {row[0]: row[1] for row in cur.fetchall()}

        corpus = AsOfCorpus(connect, cutoff)
        prior_cache: dict[tuple[int, str, str], Prior | None] = {}

        by_game: dict[str, dict[str, list[str]]] = {}
        for t in triples:
            by_game.setdefault(t["game_id"], {}).setdefault(
                t["stat_type"], []
            ).append(t["player_id"])

        failed_games = 0
        for game_id in sorted(by_game):
            game = games_by_id.get(game_id)
            if game is None:
                totals["skipped_games"] += 1
                continue
            kickoff = game["kickoff_at"]
            if cutoff >= kickoff:
                # A cutoff at or past kickoff cannot honestly project this
                # game. Skipped loudly, never silently projected.
                print(f"skip {game_id}: cutoff at or after kickoff")
                totals["skipped_games"] += 1
                record_pipeline_run_game(
                    connect,
                    run_id,
                    game_id,
                    status=GAME_SKIPPED,
                    error_message="cutoff at or after kickoff",
                )
                continue

            game_projected = 0
            try:
                with conn.transaction():
                    for stat_name in sorted(by_game[game_id]):
                        player_ids = by_game[game_id][stat_name]
                        game_projected += _project_game_stat(
                            conn,
                            corpus,
                            prior_cache,
                            game=game,
                            game_id=game_id,
                            stat_name=stat_name,
                            player_ids=player_ids,
                            seasons_by_game=seasons_by_game,
                            cutoff=cutoff,
                            now=now,
                            totals=totals,
                        )
            except Exception as exc:  # noqa: BLE001 - recorded per game; cycle continues
                failed_games += 1
                message = sanitize_error(exc)
                print(f"game {game_id} failed: {message}", file=sys.stderr)
                record_pipeline_run_game(
                    connect, run_id, game_id, status=GAME_FAILED, error_message=message
                )
                continue

            record_pipeline_run_game(
                connect,
                run_id,
                game_id,
                status=GAME_SUCCEEDED,
                projected_count=game_projected,
            )
        return failed_games


def _project_game_stat(
    conn,
    corpus: AsOfCorpus,
    prior_cache: dict[tuple[int, str, str], Prior | None],
    *,
    game: dict,
    game_id: str,
    stat_name: str,
    player_ids: list[str],
    seasons_by_game: dict[str, int],
    cutoff: datetime,
    now: datetime,
    totals: dict[str, int],
) -> int:
    """Project one (game, stat) group inside the caller's transaction.
    Returns how many projections were persisted."""
    stat = spec(stat_name)
    positions = _positions_for(corpus, (game["season"] - 1, game["season"]), stat.column)
    histories = assemble_batch(
        corpus,
        player_ids=sorted(set(player_ids)),
        game_id=game_id,
        spec=stat,
        seasons_by_game=seasons_by_game,
    )

    projected = 0
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
            kickoff=game["kickoff_at"],
            information_cutoff=cutoff,
            computed_at=now,
        )
        if isinstance(result, Unprojectable):
            totals["unprojectable"] += 1
            print(f"unprojectable {player_id} {stat_name}: {result.reason}")
            continue

        _persist(conn, result, cutoff=cutoff, computed_at=now)
        totals["projected"] += 1
        projected += 1
    return projected


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
    project.add_argument(
        "--games",
        nargs="+",
        default=None,
        metavar="GAME_ID",
        help="restrict the recompute to these game ids (game-day dispatcher scoping)",
    )
    project.add_argument(
        "--invocation-id",
        default=None,
        help="scheduler invocation id (e.g. the GitHub Actions run id); "
        "defaults to a unique manual id",
    )

    gameday = sub.add_parser(
        "gameday",
        help="game-day dispatcher: select games entering their kickoff window "
        "and run the game-scoped ingest + recompute (writes nothing when it "
        "selects nothing)",
    )
    gameday.add_argument(
        "--window-minutes",
        type=int,
        default=None,
        help="dispatch window before kickoff (default: 360)",
    )
    gameday.add_argument(
        "--invocation-id",
        default=None,
        help="scheduler invocation id (e.g. the GitHub Actions run id); "
        "defaults to a unique manual id",
    )

    args = parser.parse_args(argv)
    if args.command == "project":
        totals = run_project(
            _parse_cutoff(args.cutoff),
            games=args.games,
            invocation_id=args.invocation_id,
        )
        return 1 if totals.get("failed_games") else 0
    if args.command == "gameday":
        from .gameday import GAMEDAY_WINDOW_MINUTES, run_gameday

        return run_gameday(
            connect,
            invocation_id=args.invocation_id,
            window_minutes=args.window_minutes or GAMEDAY_WINDOW_MINUTES,
        )
    return 2  # pragma: no cover - argparse enforces the subcommand


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
