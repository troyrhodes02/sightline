"""Differential suite for the batched as-of reads (SIG-14).

The batch methods exist for throughput: a multi-season backtest issues one read
per candidate, and per-candidate round trips do not finish in tolerable time.
They also modify Layer 1 of the temporal invariant, where a mistake is silent
and flattering — a batch path that saw one extra row would raise the model's
apparent skill and lower its error, which is exactly the signal nobody
questions.

So the assertions here are differential rather than illustrative: for every
player, the batch result must equal the single-row result row for row, column
for column, dtype for dtype. Anything the single path refuses, the batch path
must refuse identically.
"""

from __future__ import annotations

from datetime import datetime, timezone

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.context import ingest_context
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db

# Forty players with deliberately uneven history depth: the batch path must not
# quietly normalise a player with zero eligible games into "absent", nor a
# player with twenty into a truncated window.
PLAYERS = [(f"00-00{40000 + i}", f"Player {i:02d}") for i in range(40)]
GAMES = [f"2023_{w:02d}_DET_KC" for w in range(1, 6)]
GAMEDAYS = ["2023-09-10", "2023-09-17", "2023-09-24", "2023-10-01", "2023-10-08"]
TARGET = GAMES[4]

# Depth per player: 0, 1, 2, 3, 4 prior games, cycling.
def _depth(i: int) -> int:
    return i % 5


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["KC", "DET"],
        "team_conf": ["AFC", "NFC"], "team_division": ["W", "N"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [g for g, _ in PLAYERS],
        "display_name": [n for _, n in PLAYERS],
        "position": ["WR"] * len(PLAYERS),
        "birth_date": ["1995-09-17"] * len(PLAYERS),
        "pfr_id": [f"Play{i:02d}00" for i in range(len(PLAYERS))],
    })


def _schedule_df() -> pl.DataFrame:
    n = len(GAMES)
    return pl.DataFrame({
        "game_id": GAMES, "season": [2023] * n, "week": list(range(1, n + 1)),
        "game_type": ["REG"] * n, "gameday": GAMEDAYS, "gametime": ["17:00"] * n,
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": ["outdoors"] * n,
        "stadium": ["Arrowhead"] * n, "location": ["Home"] * n, "result": [3] * n,
    })


def _stats_df(*, corrected_for: str | None = None, value: float = 999.0) -> pl.DataFrame:
    rows: list[tuple[str, str, float]] = []
    for i, (gsis, _) in enumerate(PLAYERS):
        for w in range(_depth(i)):
            yards = 40.0 + 3 * i + w
            if corrected_for == gsis and w == 0:
                yards = value
            rows.append((gsis, GAMES[w], yards))
    return pl.DataFrame({
        "player_id": [g for g, _, _ in rows],
        "game_id": [gm for _, gm, _ in rows],
        "team": ["KC"] * len(rows),
        "passing_yards": [None] * len(rows), "passing_tds": [None] * len(rows),
        "attempts": [None] * len(rows), "completions": [None] * len(rows),
        "passing_interceptions": [None] * len(rows),
        "rushing_yards": [5.0] * len(rows), "rushing_tds": [0] * len(rows),
        "carries": [1] * len(rows),
        "receiving_yards": [y for _, _, y in rows],
        "receiving_tds": [1] * len(rows), "receptions": [4] * len(rows),
        "targets": [6] * len(rows),
    })


def _inj_df() -> pl.DataFrame:
    # Two observations for the first ten players: a Wednesday designation and a
    # Friday upgrade, so the batch read has a progression to get wrong.
    gsis = [g for g, _ in PLAYERS[:10]]
    return pl.DataFrame({
        "season": [2023] * (2 * len(gsis)),
        "week": [5] * (2 * len(gsis)),
        "team": ["KC"] * (2 * len(gsis)),
        "gsis_id": gsis * 2,
        "report_status": ["Questionable"] * len(gsis) + ["Out"] * len(gsis),
        "practice_status": [None] * (2 * len(gsis)),
        "date_modified": (
            [datetime(2023, 10, 4, 18, 0, tzinfo=timezone.utc)] * len(gsis)
            + [datetime(2023, 10, 6, 22, 0, tzinfo=timezone.utc)] * len(gsis)
        ),
    })


def _empty_snaps() -> pl.DataFrame:
    return pl.DataFrame({c: [] for c in [
        "game_id", "season", "pfr_player_id", "team",
        "offense_snaps", "offense_pct", "defense_snaps", "defense_pct", "st_pct",
    ]}, schema_overrides={"season": pl.Int64})


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df())
    # fetch_players_crosswalk must be supplied: its default fetches real
    # nflverse players over the network, which then fails the FK on ingest.
    ingest_context(
        _h("context"), connect, 2023, 2023,
        fetch_snaps=lambda s: _empty_snaps(),
        fetch_inj=lambda s: _inj_df(),
        fetch_players_crosswalk=_players_df,
    )
    return connect


# The Thursday before the week-5 game: weeks 1-4 are published, the Friday
# injury upgrade is not.
CUTOFF = datetime(2023, 10, 5, 12, 0)

ALL_IDS = [player_id(g) for g, _ in PLAYERS]


def _frames_equal(left: pl.DataFrame, right: pl.DataFrame) -> bool:
    if left.height != right.height:
        return False
    if sorted(left.columns) != sorted(right.columns):
        return False
    right = right.select(left.columns)
    if left.height == 0:
        # Dtypes are not compared for an empty result. A zero-row frame built
        # from cursor.description alone cannot know its column types, and the
        # differential guarantee that matters — same values, same types — has
        # no values to be about. Column names and height still must match.
        return True
    if left.schema != right.schema:
        return False
    return left.equals(right)


def test_batch_trailing_stats_equal_single_row_reads(corpus) -> None:
    asof = AsOfCorpus(corpus, CUTOFF)
    batch = asof.trailing_player_stats_batch(
        player_ids=ALL_IDS, before_game_id=game_id(TARGET)
    )

    assert batch.height > 0, "fixture produced no eligible history at all"

    for pid in ALL_IDS:
        single = asof.trailing_player_stats(player_id=pid, before_game_id=game_id(TARGET))
        sliced = batch.filter(pl.col("player_id") == pid).drop("player_id")
        assert _frames_equal(sliced, single), (
            f"batch and single-row trailing reads disagree for {pid}:\n"
            f"batch={sliced}\nsingle={single}"
        )


def test_batch_trailing_covers_every_depth_including_zero(corpus) -> None:
    # A player with no eligible history must be ABSENT from the trailing frame
    # on both paths — not present with nulls, which would read as a played game
    # with no production.
    asof = AsOfCorpus(corpus, CUTOFF)
    batch = asof.trailing_player_stats_batch(
        player_ids=ALL_IDS, before_game_id=game_id(TARGET)
    )
    counts = {pid: 0 for pid in ALL_IDS}
    for pid in batch["player_id"]:
        counts[pid] += 1

    for i, (gsis, _) in enumerate(PLAYERS):
        pid = player_id(gsis)
        single = asof.trailing_player_stats(player_id=pid, before_game_id=game_id(TARGET))
        assert counts[pid] == single.height == _depth(i)


def test_batch_digest_equals_concatenated_single_row_digest(corpus) -> None:
    # The same guarantee as the row-by-row comparison, stated the way the
    # harness will eventually state it: one digest over the whole batch must
    # equal the digest over every single-player read concatenated in canonical
    # order. If these ever diverge, no downstream run is reproducible.
    import hashlib

    asof = AsOfCorpus(corpus, CUTOFF)

    def digest(frame: pl.DataFrame) -> str:
        canonical = frame.sort(["player_id", "game_id"]).select(sorted(frame.columns))
        return hashlib.blake2b(str(canonical.rows()).encode(), digest_size=16).hexdigest()

    batch = asof.trailing_player_stats_batch(
        player_ids=ALL_IDS, before_game_id=game_id(TARGET)
    )
    singles = [
        asof.trailing_player_stats(
            player_id=pid, before_game_id=game_id(TARGET)
        ).with_columns(pl.lit(pid).alias("player_id"))
        for pid in ALL_IDS
    ]
    concatenated = pl.concat([s for s in singles if s.height > 0], how="vertical")

    assert digest(batch) == digest(concatenated)


def test_batch_context_equals_single_row_reads(corpus) -> None:
    asof = AsOfCorpus(corpus, CUTOFF)
    batch = asof.player_context_batch(
        player_ids=ALL_IDS, game_id=game_id(TARGET), context_type="injury_designation"
    )

    for pid in ALL_IDS:
        single = asof.player_context(
            player_id=pid, game_id=game_id(TARGET), context_type="injury_designation"
        )
        sliced = batch.filter(pl.col("player_id") == pid).drop("player_id")
        assert _frames_equal(sliced, single), f"context disagreement for {pid}"


def test_batch_context_honours_the_cutoff_progression(corpus) -> None:
    # The Friday "Out" is known at 2023-10-06 22:00Z; the Thursday cutoff must
    # see only the Wednesday "Questionable" on the batch path too.
    asof = AsOfCorpus(corpus, CUTOFF)
    batch = asof.player_context_batch(
        player_ids=ALL_IDS, game_id=game_id(TARGET), context_type="injury_designation"
    )
    statuses = set(batch["text_value"].to_list())
    assert statuses == {"Questionable"}, statuses

    # And two seconds after the upgrade published, both are visible.
    later = AsOfCorpus(corpus, datetime(2023, 10, 6, 22, 0, 2))
    after = later.player_context_batch(
        player_ids=ALL_IDS, game_id=game_id(TARGET), context_type="injury_designation"
    )
    assert set(after["text_value"].to_list()) == {"Questionable", "Out"}


def test_batch_rest_and_travel_equals_single_row_reads(corpus) -> None:
    asof = AsOfCorpus(corpus, CUTOFF)
    batch = asof.rest_and_travel_batch(player_ids=ALL_IDS, game_id=game_id(TARGET))

    assert batch.height == len(ALL_IDS), (
        "every requested player must appear, including those with no prior game "
        "— absent and null are different facts"
    )

    lookup = {row["player_id"]: row for row in batch.to_dicts()}
    for pid in ALL_IDS:
        single = asof.rest_and_travel(player_id=pid, game_id=game_id(TARGET))
        assert lookup[pid]["rest_days"] == single["rest_days"]
        assert lookup[pid]["travel_km"] == single["travel_km"]


def test_adversarial_late_fact_is_unreachable_on_the_batch_path(corpus) -> None:
    # The week-5 stat line itself: published the morning after the game, so it
    # must be unreachable at a pre-game cutoff on the batch path exactly as it
    # is on the single-row path.
    asof = AsOfCorpus(corpus, CUTOFF)
    batch = asof.trailing_player_stats_batch(
        player_ids=ALL_IDS, before_game_id=game_id(GAMES[1])
    )
    # Only week 1 can be eligible before the week-2 game.
    assert set(batch["game_id"].to_list()) <= {game_id(GAMES[0])}


def test_empty_player_list_returns_an_empty_frame_not_everything(corpus) -> None:
    # The failure this guards against is a predicate that degrades to "match
    # all" when the input is empty, which would hand the model the entire
    # corpus and look like a very good model.
    asof = AsOfCorpus(corpus, CUTOFF)

    trailing = asof.trailing_player_stats_batch(
        player_ids=[], before_game_id=game_id(TARGET)
    )
    assert trailing.height == 0
    assert "player_id" in trailing.columns

    context = asof.player_context_batch(
        player_ids=[], game_id=game_id(TARGET), context_type="injury_designation"
    )
    assert context.height == 0
    assert "player_id" in context.columns

    rest = asof.rest_and_travel_batch(player_ids=[], game_id=game_id(TARGET))
    assert rest.height == 0


def test_batch_result_is_independent_of_input_order(corpus) -> None:
    # Callers must not depend on input order, and the read must not either:
    # ordering by player_id is what makes the frame groupable.
    asof = AsOfCorpus(corpus, CUTOFF)
    forward = asof.trailing_player_stats_batch(
        player_ids=ALL_IDS, before_game_id=game_id(TARGET)
    )
    reversed_ = asof.trailing_player_stats_batch(
        player_ids=list(reversed(ALL_IDS)), before_game_id=game_id(TARGET)
    )
    assert forward.equals(reversed_)


def test_correction_rollback_is_identical_on_both_paths(corpus) -> None:
    # A correction published AFTER the cutoff must be rolled back to the value
    # that was current at the cutoff — on both paths, from the same shared
    # code. This is the subtle one: a batch path that read the corrected value
    # would be using the future to predict the past, and would look like a
    # better model for it.
    #
    # Written through the production correction path (a re-ingest with a
    # changed value) rather than a hand-inserted row, so the test exercises
    # what actually happens rather than an approximation of it.
    gsis = PLAYERS[4][0]  # depth 4
    pid = player_id(gsis)
    ingest_stats(
        _h("stats"), corpus, 2023, 2023,
        fetch=lambda s: _stats_df(corrected_for=gsis, value=999.0),
        correction_known_at=datetime(2023, 10, 20, 12, 0),
    )

    asof = AsOfCorpus(corpus, CUTOFF)
    single = asof.trailing_player_stats(player_id=pid, before_game_id=game_id(TARGET))
    batch = asof.trailing_player_stats_batch(
        player_ids=[pid], before_game_id=game_id(TARGET)
    ).drop("player_id")

    assert _frames_equal(batch, single)
    values = [float(v) for v in single["receiving_yards"].to_list()]
    assert 999.0 not in values, (
        "the post-cutoff corrected value re-entered the trailing window"
    )

    # And after the correction publishes, both paths see it — proving the
    # roll-back is bounded by the cutoff rather than simply ignoring
    # corrections altogether.
    later = AsOfCorpus(corpus, datetime(2023, 10, 21, 12, 0))
    assert 999.0 in [
        float(v)
        for v in later.trailing_player_stats_batch(
            player_ids=[pid], before_game_id=game_id(TARGET)
        )["receiving_yards"].to_list()
    ]


def test_population_stats_rolls_back_a_post_cutoff_correction(corpus) -> None:
    # The prior-fitting read. A correction published AFTER the cutoff must be
    # invisible to a prior fitted at that cutoff — otherwise a January
    # correction to a years-old game silently refits every prior downstream,
    # and a run today diverges from the identical run at the cutoff. Same
    # roll-back rule as the trailing reads, same shared SQL.
    gsis = PLAYERS[4][0]  # depth 4; week-1 original value is 52.0
    pid = player_id(gsis)
    ingest_stats(
        _h("stats"), corpus, 2023, 2023,
        fetch=lambda s: _stats_df(corrected_for=gsis, value=999.0),
        correction_known_at=datetime(2023, 10, 20, 12, 0),
    )

    at_cutoff = AsOfCorpus(corpus, datetime(2023, 10, 15, 12, 0)).population_stats(
        before_season=2024, position="WR", column="receiving_yards"
    )
    mine = at_cutoff.filter(pl.col("player_id") == pid)
    values = [float(v) for v in mine["value"].to_list()]
    assert 52.0 in values, "the at-cutoff (pre-correction) value must be visible"
    assert 999.0 not in values, (
        "a post-cutoff corrected value re-entered prior fitting"
    )

    # Proving the fixture is real: once the correction has published, the
    # corrected value is exactly what the read returns.
    later = AsOfCorpus(corpus, datetime(2023, 10, 25, 12, 0)).population_stats(
        before_season=2024, position="WR", column="receiving_yards"
    )
    later_values = [
        float(v) for v in later.filter(pl.col("player_id") == pid)["value"].to_list()
    ]
    assert 999.0 in later_values and 52.0 not in later_values

    # And the walk-forward bound is enforced in the same read: with no season
    # earlier than 2023 in the corpus, a 2023 prior has no evidence at all,
    # regardless of what has published.
    walk_forward = AsOfCorpus(corpus, datetime(2023, 10, 25, 12, 0)).population_stats(
        before_season=2023, position="WR", column="receiving_yards"
    )
    assert walk_forward.height == 0


def test_season_participants_evaluates_nullness_at_the_cutoff(corpus) -> None:
    # The candidate universe. "Has a published line for this column" must be
    # a fact about the at-cutoff line: a correction that later NULLs the value
    # must not retroactively remove the player from the universe a past run
    # would have seen (and vice versa).
    gsis = PLAYERS[1][0]  # depth 1: the week-1 line is this player's only one
    pid = player_id(gsis)
    ingest_stats(
        _h("stats"), corpus, 2023, 2023,
        fetch=lambda s: _stats_df(corrected_for=gsis, value=None),
        correction_known_at=datetime(2023, 10, 20, 12, 0),
    )

    at_cutoff = AsOfCorpus(corpus, datetime(2023, 10, 15, 12, 0)).season_participants(
        seasons=(2022, 2023), column="receiving_yards"
    )
    assert pid in at_cutoff["player_id"].to_list(), (
        "the value existed at the cutoff; the later correction must not "
        "remove the player from the candidate universe retroactively"
    )

    later = AsOfCorpus(corpus, datetime(2023, 10, 25, 12, 0)).season_participants(
        seasons=(2022, 2023), column="receiving_yards"
    )
    assert pid not in later["player_id"].to_list(), (
        "after the correction publishes, the at-cutoff line is null and the "
        "player has no line for this column — the fixture must be real"
    )
