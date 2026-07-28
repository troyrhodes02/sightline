"""Adversarial temporal-leakage suite (priority 1, gating).

Written to attack the as-of layer: construct a leak and prove it is blocked. A
row known after the cutoff must be structurally unreachable — absent from the
result, not filtered afterward. Requires a database.
"""

from __future__ import annotations

from datetime import datetime, timezone

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import (
    day_after_game_knownat,
    game_id,
    parse_kickoff,
    player_id,
)
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

# Sharp-edge fixtures for the day-after publication rule:
# a Saturday 4:30pm EST doubleheader game (21:30 UTC — the UTC date flips to
# Sunday at 7pm EST, while the game is still being played) and the week-16
# game that follows it, plus a January playoff game for the postseason
# schedule-release bound.
SAT_GAME = "2023_15_DET_KC"      # Sat 2023-12-16 16:30 ET
WK16_GAME = "2023_16_DET_KC"     # Sun 2023-12-24 13:00 ET
POST_GAME = "2023_19_DET_KC"     # wild card, Sun 2024-01-14 17:00 ET


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


def _schedule_df(*, wk3_gameday: str = "2023-09-24") -> pl.DataFrame:
    ids = [*GAMES, SAT_GAME, WK16_GAME, POST_GAME]
    gamedays = [GAMEDAYS[0], GAMEDAYS[1], wk3_gameday, GAMEDAYS[3], GAMEDAYS[4],
                "2023-12-16", "2023-12-24", "2024-01-14"]
    n = len(ids)
    return pl.DataFrame({
        "game_id": ids, "season": [2023] * n,
        "week": [1, 2, 3, 4, 5, 15, 16, 19],
        "game_type": ["REG"] * 7 + ["POST"],
        "gameday": gamedays,
        "gametime": ["17:00"] * 5 + ["16:30", "13:00", "17:00"],
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": ["outdoors"] * n,
        "stadium": ["Arrowhead"] * n, "location": ["Home"] * n, "result": [3] * n,
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
    # date_modified is tz-aware UTC upstream; the ingest enforces that.
    return pl.DataFrame({
        "season": [2023], "week": [1], "team": ["KC"], "gsis_id": [GSIS],
        "report_status": [status], "practice_status": [None],
        "date_modified": [modified.replace(tzinfo=timezone.utc)],
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

    # Boundary is inclusive: a cutoff EXACTLY equal to a fact's known_at sees
    # it ("known at the cutoff" includes the cutoff instant itself).
    at_boundary = AsOfCorpus(connect, fri)
    assert at_boundary.latest_injury_designation(player_id=pid, game_id=gid) == "Out"


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


def test_weather_reads_respect_cutoff(base) -> None:
    connect = base
    # A weather row known only AFTER the cutoff is absent.
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


# --- 6. Schedule-as-known: revisions, flexes, postseason ---------------------

def test_schedule_as_known_ignores_post_cutoff_flex(base) -> None:
    connect = base
    gid = game_id(GAMES[2])
    original_kick = parse_kickoff("2023-09-24", "17:00")

    # Flex week 3 to Monday, announced Sep 23 — AFTER our Friday cutoff.
    flex_known = datetime(2023, 9, 23, 12, 0)
    ingest_schedule(_h("schedule"), connect, 2023, 2023,
                    fetch=lambda s: _schedule_df(wk3_gameday="2023-09-25"),
                    revision_known_at=flex_known)

    friday = AsOfCorpus(connect, datetime(2023, 9, 22, 12, 0))
    known = friday.schedule_as_known(game_id=gid)
    assert known.height == 1
    assert known["kickoff_at"][0] == original_kick  # the flex is unreachable

    # The initial (bulk-load) revision must carry the PRE-game status: a
    # historical load knows the result, but the revision stream must never
    # claim 'completed' was known at the schedule release.
    assert known["status"][0] == "scheduled"

    after = AsOfCorpus(connect, datetime(2023, 9, 23, 13, 0))
    assert after.schedule_as_known(game_id=gid)["kickoff_at"][0] == parse_kickoff(
        "2023-09-25", "17:00"
    )


def test_postseason_schedule_is_not_known_at_season_release(base) -> None:
    connect = base
    gid = game_id(POST_GAME)  # wild card, kicks off 2024-01-14

    # Mid-season: the playoff matchup does not exist yet. Stamping it at the
    # Aug-1 release would encode playoff qualification backwards into the season.
    november = AsOfCorpus(connect, datetime(2023, 11, 1, 0, 0))
    assert november.schedule_as_known(game_id=gid).height == 0

    # Five days before kickoff it is known (conservative later bound).
    wild_card_week = AsOfCorpus(connect, datetime(2024, 1, 10, 0, 0))
    assert wild_card_week.schedule_as_known(game_id=gid).height == 1


# --- 7. The day-after publication rule at its sharp edges --------------------

def test_saturday_game_stats_unreachable_until_next_morning_et(base) -> None:
    connect = base
    # Final stats for the Saturday 4:30pm EST game exist in the corpus.
    ingest_stats(_h("stats"), connect, 2023, 2023,
                 fetch=lambda s: _stats_df([(SAT_GAME, "KC", 275.0)]))
    pid = player_id(GSIS)
    sat_kick = parse_kickoff("2023-12-16", "16:30")  # 21:30 UTC
    published = day_after_game_knownat(sat_kick)
    # The rule in Python: 09:00 ET Sunday = 14:00 UTC. Pin it exactly so the
    # SQL twin below is checked against a known value, not against itself.
    assert published == datetime(2023, 12, 17, 14, 0)

    def trailing_at(cutoff: datetime) -> set[str]:
        frame = AsOfCorpus(connect, cutoff).trailing_player_stats(
            player_id=pid, before_game_id=game_id(WK16_GAME)
        )
        return set(frame["game_id"].to_list()) if frame.height else set()

    # 7pm EST Saturday is midnight UTC Sunday — the UTC date has flipped but
    # the game is still in the fourth quarter. A UTC day-after rule would leak
    # the final stat line right here.
    during_game_et = datetime(2023, 12, 17, 0, 30)  # Sat 7:30pm EST
    assert game_id(SAT_GAME) not in trailing_at(during_game_et)

    # Still unreachable just before the next-morning publication bound…
    assert game_id(SAT_GAME) not in trailing_at(datetime(2023, 12, 17, 13, 59))
    # …and reachable AT the bound (inclusive) and after.
    assert game_id(SAT_GAME) in trailing_at(published)
    assert game_id(SAT_GAME) in trailing_at(datetime(2023, 12, 18, 0, 0))


def test_sunday_afternoon_stats_unreachable_at_snf_kickoff(base) -> None:
    connect = base
    ingest_stats(_h("stats"), connect, 2023, 2023,
                 fetch=lambda s: _stats_df([(GAMES[0], "KC", 300.0)]))
    pid = player_id(GSIS)
    # Sunday Night Football cutoff: 8:15pm ET Sep 10 = 00:15 UTC Sep 11. The
    # 1pm/4:25pm slate's final lines are NOT published yet — nflverse posts
    # them overnight. midnight-UTC-Monday would have leaked them here.
    snf_cutoff = datetime(2023, 9, 11, 0, 15)
    frame = AsOfCorpus(connect, snf_cutoff).trailing_player_stats(
        player_id=pid, before_game_id=game_id(GAMES[4])
    )
    assert frame.height == 0
    # Next morning at 09:00 ET (13:00 UTC) they publish.
    frame = AsOfCorpus(connect, datetime(2023, 9, 11, 13, 0)).trailing_player_stats(
        player_id=pid, before_game_id=game_id(GAMES[4])
    )
    assert set(frame["game_id"].to_list()) == {game_id(GAMES[0])}


# --- 8. Rest & travel: derived for the TARGET game, flex-invariant -----------

def test_rest_and_travel_pairs_target_with_previous_game(base) -> None:
    connect = base
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df(
        [(GAMES[0], "KC", 200.0), (GAMES[1], "KC", 210.0)]
    ))
    pid = player_id(GSIS)
    # Projecting week 3 (Sun Sep 24) from Friday Sep 22: the previous game is
    # week 2 (Sun Sep 17) -> 7 rest days into the TARGET game, not the 7 days
    # between weeks 1 and 2 that the previous-pair bug produced.
    friday = AsOfCorpus(connect, datetime(2023, 9, 22, 12, 0))
    result = friday.rest_and_travel(player_id=pid, game_id=game_id(GAMES[2]))
    assert result["rest_days"] == 7
    assert result["travel_km"] == 0.0  # KC home -> KC home


def test_rest_and_travel_is_invariant_to_post_cutoff_flex(base) -> None:
    connect = base
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df(
        [(GAMES[0], "KC", 200.0), (GAMES[1], "KC", 210.0)]
    ))
    pid = player_id(GSIS)
    cutoff = datetime(2023, 9, 22, 12, 0)
    before = AsOfCorpus(connect, cutoff).rest_and_travel(
        player_id=pid, game_id=game_id(GAMES[2])
    )

    # Week 3 flexes Sunday -> Monday, announced AFTER the cutoff. Derived from
    # schedule-as-known, the feature at the same cutoff must not move — the
    # mutable games row has, but that row is not the read path.
    ingest_schedule(_h("schedule"), connect, 2023, 2023,
                    fetch=lambda s: _schedule_df(wk3_gameday="2023-09-25"),
                    revision_known_at=datetime(2023, 9, 23, 12, 0))
    after = AsOfCorpus(connect, cutoff).rest_and_travel(
        player_id=pid, game_id=game_id(GAMES[2])
    )
    assert before == after == {"rest_days": 7, "travel_km": 0.0}

    # Once the flex IS known, the same derivation reflects it: one extra day.
    post_flex = AsOfCorpus(connect, datetime(2023, 9, 23, 13, 0)).rest_and_travel(
        player_id=pid, game_id=game_id(GAMES[2])
    )
    assert post_flex["rest_days"] == 8
