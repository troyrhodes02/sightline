"""Adversarial temporal-leakage suite (priority 1, gating).

Written to attack the as-of layer: construct a leak and prove it is blocked. A
row known after the cutoff must be structurally unreachable — absent from the
result, not filtered afterward. Requires a database.
"""

from __future__ import annotations

from datetime import datetime

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.context import ingest_context
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.grading import GradingCorpus
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db

GSIS = "00-0033873"
GAMES = [f"2023_0{w}_DET_KC" for w in range(1, 6)]  # weeks 1-5
# Weekly kickoffs (Sunday 17:00 ET -> 21:00 UTC).
GAMEDAYS = ["2023-09-10", "2023-09-17", "2023-09-24", "2023-10-01", "2023-10-08"]


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["KC", "DET"],
        "team_conf": ["AFC", "NFC"], "team_division": ["W", "N"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [GSIS], "display_name": ["Patrick Mahomes"], "position": ["QB"],
        "birth_date": ["1995-09-17"], "pfr_id": ["MahoPa00"],
    })


def _schedule_df() -> pl.DataFrame:
    n = len(GAMES)
    return pl.DataFrame({
        "game_id": GAMES, "season": [2023] * n, "week": list(range(1, n + 1)),
        "game_type": ["REG"] * n, "gameday": GAMEDAYS, "gametime": ["17:00"] * n,
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": ["outdoors"] * n,
        "stadium": ["Arrowhead"] * n, "result": [3] * n,
    })


def _stats_df(specs: list[tuple[str, str, float]]) -> pl.DataFrame:
    """specs: list of (nfl_game_id, team, passing_yards)."""
    return pl.DataFrame({
        "player_id": [GSIS] * len(specs),
        "game_id": [g for g, _, _ in specs],
        "team": [t for _, t, _ in specs],
        "passing_yards": [y for _, _, y in specs],
        "passing_tds": [2] * len(specs), "attempts": [30] * len(specs),
        "completions": [20] * len(specs), "passing_interceptions": [0] * len(specs),
        "rushing_yards": [10.0] * len(specs), "rushing_tds": [0] * len(specs),
        "carries": [3] * len(specs), "receiving_yards": [None] * len(specs),
        "receiving_tds": [None] * len(specs), "receptions": [None] * len(specs),
        "targets": [None] * len(specs),
    })


def _inj_df(status: str, modified: datetime) -> pl.DataFrame:
    return pl.DataFrame({
        "season": [2023], "week": [1], "team": ["KC"], "gsis_id": [GSIS],
        "report_status": [status], "practice_status": [None], "date_modified": [modified],
    })


def _empty_snaps() -> pl.DataFrame:
    return pl.DataFrame({c: [] for c in [
        "game_id", "season", "pfr_player_id", "team",
        "offense_snaps", "offense_pct", "defense_snaps", "defense_pct", "st_pct",
    ]}, schema_overrides={"season": pl.Int64})


@pytest.fixture
def base(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    return connect


def _add_injury(connect, status: str, modified: datetime) -> None:
    ingest_context(_h("context"), connect, 2023, 2023,
                   fetch_snaps=lambda s: _empty_snaps(),
                   fetch_inj=lambda s: _inj_df(status, modified),
                   fetch_players_crosswalk=_players_df)


# --- 1. Late fact is structurally unreachable ------------------------------

def test_late_injury_fact_is_unreachable_at_prior_cutoff(base) -> None:
    connect = base
    wed = datetime(2023, 9, 6, 15, 0)   # Wednesday report
    fri = datetime(2023, 9, 8, 18, 0)   # Friday evening report
    _add_injury(connect, "Questionable", wed)
    _add_injury(connect, "Out", fri)

    pid, gid = player_id(GSIS), game_id(GAMES[0])
    friday_morning = datetime(2023, 9, 8, 9, 0)  # before the Friday-evening 'Out'
    asof = AsOfCorpus(connect, friday_morning)

    # The Friday-evening 'Out' is absent; the Wednesday 'Questionable' is returned.
    assert asof.latest_injury_designation(player_id=pid, game_id=gid) == "Questionable"
    ctx = asof.player_context(player_id=pid, game_id=gid, context_type="injury_designation")
    assert ctx.height == 1                      # the late row is ABSENT, not filtered
    assert ctx["text_value"].to_list() == ["Questionable"]

    # After the Friday report is known, the 'Out' becomes reachable.
    later = AsOfCorpus(connect, datetime(2023, 9, 9, 9, 0))
    assert later.latest_injury_designation(player_id=pid, game_id=gid) == "Out"


# --- 2. Recompute is time-invariant ----------------------------------------

def test_recompute_is_time_invariant_under_late_arrivals(base) -> None:
    connect = base
    ingest_stats(_h("stats"), connect, 2023, 2023,
                 fetch=lambda s: _stats_df([(GAMES[0], "KC", 300.0), (GAMES[1], "KC", 250.0)]))
    pid = player_id(GSIS)
    cutoff = datetime(2023, 9, 20, 0, 0)  # after wk1+wk2 day-after, before wk3
    asof = AsOfCorpus(connect, cutoff)
    before = asof.trailing_player_stats(player_id=pid, before_game_id=game_id(GAMES[4]))

    # Late arrivals after the cutoff: a new injury and a stat correction.
    _add_injury(connect, "Out", datetime(2023, 10, 1, 12, 0))
    ingest_stats(_h("stats"), connect, 2023, 2023,
                 fetch=lambda s: _stats_df([(GAMES[0], "KC", 999.0)]),
                 correction_known_at=datetime(2023, 10, 1, 12, 0))

    after = AsOfCorpus(connect, cutoff).trailing_player_stats(
        player_id=pid, before_game_id=game_id(GAMES[4])
    )
    # The eligible inputs as-of the cutoff are identical then and now.
    assert before.sort("game_id").to_dicts() == after.sort("game_id").to_dicts()
    # And the post-cutoff correction did not leak into the as-of value.
    wk1 = after.filter(pl.col("game_id") == game_id(GAMES[0]))
    assert float(wk1["passing_yards"][0]) == 300.0


# --- 3. Season aggregates exclude the future; team stays per-game -----------

def test_trailing_stats_cannot_include_future_games(base) -> None:
    connect = base
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df(
        [(GAMES[i], "KC", 200.0 + i) for i in range(5)]  # weeks 1-5
    ))
    pid = player_id(GSIS)
    # Cutoff after week-2's day-after, before week-3's day-after.
    cutoff = datetime(2023, 9, 20, 0, 0)
    trailing = AsOfCorpus(connect, cutoff).trailing_player_stats(
        player_id=pid, before_game_id=game_id(GAMES[4])
    )
    games = set(trailing["game_id"].to_list())
    assert games == {game_id(GAMES[0]), game_id(GAMES[1])}  # weeks 3-5 are future
    assert game_id(GAMES[2]) not in games


def test_team_context_follows_the_game_not_current_roster(base) -> None:
    connect = base
    # Player on KC weeks 1-2, traded to DET weeks 3-4.
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df([
        (GAMES[0], "KC", 200.0), (GAMES[1], "KC", 210.0),
        (GAMES[2], "DET", 220.0), (GAMES[3], "DET", 230.0),
    ]))
    pid = player_id(GSIS)
    cutoff = datetime(2023, 10, 15, 0, 0)  # all four known
    trailing = AsOfCorpus(connect, cutoff).trailing_player_stats(
        player_id=pid, before_game_id=game_id(GAMES[4])
    ).sort("kickoff_at")
    teams = trailing["team_abbr_at_game"].to_list()
    assert teams == ["KC", "KC", "DET", "DET"]  # each game's team, never a single "current" team
    # There is no current-team accessor to leak from.
    assert not hasattr(AsOfCorpus, "current_team")


# --- 4. Corrected actuals are walled off from features ----------------------

def test_correction_after_cutoff_is_unreachable_via_feature_path(base) -> None:
    connect = base
    ingest_stats(_h("stats"), connect, 2023, 2023,
                 fetch=lambda s: _stats_df([(GAMES[0], "KC", 84.0)]))
    # A correction lands well after the game (and after our cutoff).
    correction_time = datetime(2023, 9, 20, 12, 0)
    ingest_stats(_h("stats"), connect, 2023, 2023,
                 fetch=lambda s: _stats_df([(GAMES[0], "KC", 88.0)]),
                 correction_known_at=correction_time)

    pid, gid = player_id(GSIS), game_id(GAMES[0])
    cutoff = datetime(2023, 9, 12, 0, 0)  # after the game, before the correction
    feature = AsOfCorpus(connect, cutoff).trailing_player_stats(
        player_id=pid, before_game_id=game_id(GAMES[4])
    )
    wk1 = feature.filter(pl.col("game_id") == gid)
    # Feature path sees the value as published at the cutoff (84), never the correction (88).
    assert float(wk1["passing_yards"][0]) == 84.0

    # The grading path (walled off) does see the corrected value.
    graded = GradingCorpus(connect).final_player_stat(player_id=pid, game_id=gid)
    assert float(graded["passing_yards"][0]) == 88.0
    assert graded["version"][0] == 2


# --- 5. Structural: the feature path cannot reach the grading path ----------

def test_asof_module_does_not_import_grading() -> None:
    import ast
    from pathlib import Path

    import sightline_ingest.asof as asof_mod

    source = Path(asof_mod.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)
        elif isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names)
    assert not any("grading" in m for m in imported), (
        "the as-of feature path must not import the grading (corrected-actuals) read"
    )


def test_weather_and_schedule_reads_respect_cutoff(base) -> None:
    connect = base
    # A schedule revision and weather both known only AFTER the cutoff are absent.
    gid = game_id(GAMES[0])
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "insert into game_weather (id, game_id, era, status, weather_source, "
                "valid_at, known_at, source, ingest_run_id) values "
                "(gen_random_uuid(), %s, 'archived_forecast', 'observed', 'x', "
                "'2023-09-08 12:00', '2023-09-08 12:00', 'open_meteo', 'r')",
                (gid,),
            )
        conn.commit()
    early = AsOfCorpus(connect, datetime(2023, 9, 1, 0, 0))  # before the weather knownAt
    assert early.game_weather(game_id=gid).height == 0
    late = AsOfCorpus(connect, datetime(2023, 9, 10, 0, 0))
    assert late.game_weather(game_id=gid).height == 1
