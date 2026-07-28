"""Feature assembly against a real corpus (SIG-16).

The gating assertion is the one at the bottom: a projection for a past game
must be identical whether computed from the full corpus at the stored cutoff or
from a corpus in which every post-cutoff row was never inserted. Everything
else here supports that — eligibility, null handling, and the structural
guarantee that feature code has no path to a connection.
"""

from __future__ import annotations

import inspect
from datetime import datetime, timezone

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle
from sightline_model import features as features_module
from sightline_model import projection as projection_module
from sightline_model.features import assemble, assemble_batch
from sightline_model.priors import Prior
from sightline_model.projection import project_one
from sightline_model.stat_types import spec

pytestmark = pytest.mark.db

QB = "00-0033873"   # passing yards every week
WR = "00-0036900"   # receiving yards; null passing
ROOKIE = "00-0039900"  # no eligible history before week 1

GAMES = [f"2023_{w:02d}_DET_KC" for w in range(1, 7)]
GAMEDAYS = ["2023-09-10", "2023-09-17", "2023-09-24", "2023-10-01",
            "2023-10-08", "2023-10-15"]
TARGET = GAMES[5]

CUTOFF = datetime(2023, 10, 15, 15, 30)
KICKOFF = datetime(2023, 10, 15, 21, 0)
COMPUTED = datetime(2026, 7, 28, 12, 14)

PRIOR = Prior(
    season=2023, stat_type="receiving_yards", position="WR",
    fitted_from_seasons=(2019, 2020, 2021, 2022), sample_games=18_000,
    sample_players=1_200, p_zero=0.12, mu=3.55, sigma=0.95,
)


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["KC", "DET"],
        "team_conf": ["AFC", "NFC"], "team_division": ["W", "N"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [QB, WR, ROOKIE],
        "display_name": ["Patrick Mahomes", "Rashee Rice", "Rookie Debut"],
        "position": ["QB", "WR", "WR"],
        "birth_date": ["1995-09-17", "2000-01-01", "2002-01-01"],
        "pfr_id": ["MahoPa00", "RiceRa00", "RookRo00"],
    })


def _schedule_df() -> pl.DataFrame:
    n = len(GAMES)
    return pl.DataFrame({
        "game_id": GAMES, "season": [2023] * n, "week": list(range(1, n + 1)),
        "game_type": ["REG"] * n, "gameday": GAMEDAYS, "gametime": ["17:00"] * n,
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": ["outdoors"] * n,
        "stadium": ["Arrowhead"] * n, "location": ["Home"] * n, "result": [3] * n,
    })


def _stats_df(*, through_week: int = 6) -> pl.DataFrame:
    rows = []
    for w in range(through_week):
        rows.append((QB, GAMES[w], 280.0 + 5 * w, None))
        rows.append((WR, GAMES[w], None, 50.0 + 4 * w))
    return pl.DataFrame({
        "player_id": [r[0] for r in rows],
        "game_id": [r[1] for r in rows],
        "team": ["KC"] * len(rows),
        "passing_yards": [r[2] for r in rows],
        "passing_tds": [2 if r[2] is not None else None for r in rows],
        "attempts": [30 if r[2] is not None else None for r in rows],
        "completions": [20 if r[2] is not None else None for r in rows],
        "passing_interceptions": [0 if r[2] is not None else None for r in rows],
        "rushing_yards": [3.0] * len(rows), "rushing_tds": [0] * len(rows),
        "carries": [1] * len(rows),
        "receiving_yards": [r[3] for r in rows],
        "receiving_tds": [1 if r[3] is not None else None for r in rows],
        "receptions": [4 if r[3] is not None else None for r in rows],
        "targets": [6 if r[3] is not None else None for r in rows],
    })


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df())
    return connect


SEASONS = {game_id(g): 2023 for g in GAMES}


# --- Structural --------------------------------------------------------------


def test_feature_and_projection_modules_cannot_open_a_connection() -> None:
    # The guarantee is structural, not behavioural: a feature function that
    # COULD open its own connection could read a fact table without a cutoff.
    # Removing the possibility is cheaper and more durable than testing for its
    # absence one call site at a time.
    for module in (features_module, projection_module):
        source = inspect.getsource(module)
        for forbidden in ("connection_factory", "psycopg", "ingest_dsn", "DATABASE_URL"):
            assert forbidden not in source, f"{module.__name__} references {forbidden}"


def test_assemble_requires_an_asof_corpus_not_a_connection() -> None:
    signature = inspect.signature(assemble)
    annotation = signature.parameters["corpus"].annotation
    assert annotation is AsOfCorpus or annotation == "AsOfCorpus"


# --- Eligibility -------------------------------------------------------------


def test_only_games_published_before_the_cutoff_are_eligible(corpus) -> None:
    asof = AsOfCorpus(corpus, CUTOFF)
    history = assemble(
        asof, player_id=player_id(WR), game_id=game_id(TARGET),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    # Weeks 1-5 published; week 6 is the target and has not been played.
    assert history.n_eff == 5
    assert history.values == [50.0, 54.0, 58.0, 62.0, 66.0]


def test_a_null_column_is_absence_not_zero(corpus) -> None:
    # The quarterback has NULL receiving_yards every week. Treating that as a
    # zero-yard receiving performance would drag every quarterback's receiving
    # projection toward a number no quarterback ever posts.
    asof = AsOfCorpus(corpus, CUTOFF)
    history = assemble(
        asof, player_id=player_id(QB), game_id=game_id(TARGET),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    assert history.n_eff == 0
    assert history.values == []

    # And the same player has full eligible history for the stat he does record.
    passing = assemble(
        asof, player_id=player_id(QB), game_id=game_id(TARGET),
        spec=spec("passing_yards"), seasons_by_game=SEASONS,
    )
    assert passing.n_eff == 5


def test_batch_assembly_includes_players_with_no_history(corpus) -> None:
    # Omitting them would make "no history" indistinguishable from "not asked
    # for", and the harness needs to tell those apart to reconcile candidates.
    asof = AsOfCorpus(corpus, CUTOFF)
    ids = [player_id(QB), player_id(WR), player_id(ROOKIE)]
    histories = assemble_batch(
        asof, player_ids=ids, game_id=game_id(TARGET),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    assert set(histories) == set(ids)
    assert histories[player_id(ROOKIE)].n_eff == 0
    assert histories[player_id(WR)].n_eff == 5


def test_batch_and_single_assembly_agree(corpus) -> None:
    asof = AsOfCorpus(corpus, CUTOFF)
    ids = [player_id(QB), player_id(WR), player_id(ROOKIE)]
    batch = assemble_batch(
        asof, player_ids=ids, game_id=game_id(TARGET),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    for pid in ids:
        single = assemble(
            asof, player_id=pid, game_id=game_id(TARGET),
            spec=spec("receiving_yards"), seasons_by_game=SEASONS,
        )
        assert batch[pid] == single


# --- Weighting ---------------------------------------------------------------


def test_form_weights_are_normalised_and_favour_recency(corpus) -> None:
    asof = AsOfCorpus(corpus, CUTOFF)
    history = assemble(
        asof, player_id=player_id(WR), game_id=game_id(TARGET),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    weights = history.weights()
    assert sum(weights) == pytest.approx(1.0)
    assert weights == sorted(weights), "weights must increase toward the present"
    assert history.ew_mean() > sum(history.values) / len(history.values)


# --- The gating guarantee ----------------------------------------------------


def test_projection_is_identical_with_and_without_post_cutoff_rows(
    connect, clean_db
) -> None:
    # Computed now against a past cutoff, versus computed from a corpus that
    # never contained anything after that cutoff. If these differ, the model is
    # using the future to predict the past — and it would look BETTER for it.
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2023, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df(through_week=3))

    truncated = project_one(
        assemble(
            AsOfCorpus(connect, CUTOFF), player_id=player_id(WR),
            game_id=game_id(TARGET), spec=spec("receiving_yards"),
            seasons_by_game=SEASONS,
        ),
        prior=PRIOR, spec=spec("receiving_yards"), game_id=game_id(TARGET),
        kickoff=KICKOFF, information_cutoff=CUTOFF, computed_at=COMPUTED,
    )

    # Now add everything that happened afterward, including the target game.
    ingest_stats(_h("stats"), connect, 2023, 2023, fetch=lambda s: _stats_df(through_week=6))

    full = project_one(
        assemble(
            AsOfCorpus(connect, CUTOFF), player_id=player_id(WR),
            game_id=game_id(TARGET), spec=spec("receiving_yards"),
            seasons_by_game=SEASONS,
        ),
        prior=PRIOR, spec=spec("receiving_yards"), game_id=game_id(TARGET),
        kickoff=KICKOFF, information_cutoff=CUTOFF, computed_at=COMPUTED,
    )

    assert truncated.n_eff == 3, "fixture did not actually truncate"
    assert full.n_eff == 5, "later weeks published before the cutoff must count"
    # Weeks 4 and 5 kicked off and published BEFORE the cutoff, so they are
    # legitimately eligible. What must never appear is the target game itself.
    assert game_id(TARGET) not in full.drivers[0]

    at_cutoff = AsOfCorpus(connect, CUTOFF).trailing_player_stats(
        player_id=player_id(WR), before_game_id=game_id(TARGET)
    )
    assert game_id(TARGET) not in at_cutoff["game_id"].to_list()


def test_target_game_never_enters_its_own_projection(corpus) -> None:
    # The single most important assertion about the engine: the game being
    # predicted contributes nothing to the prediction.
    asof = AsOfCorpus(corpus, CUTOFF)
    history = assemble(
        asof, player_id=player_id(WR), game_id=game_id(TARGET),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    assert game_id(TARGET) not in history.game_ids
    assert all(k < KICKOFF.replace(tzinfo=None) for k in history.kickoffs)


def test_rookie_debut_declines_rather_than_guessing(corpus) -> None:
    asof = AsOfCorpus(corpus, datetime(2023, 9, 10, 15, 30))
    history = assemble(
        asof, player_id=player_id(ROOKIE), game_id=game_id(GAMES[0]),
        spec=spec("receiving_yards"), seasons_by_game=SEASONS,
    )
    result = project_one(
        history, prior=PRIOR, spec=spec("receiving_yards"),
        game_id=game_id(GAMES[0]), kickoff=datetime(2023, 9, 10, 21, 0),
        information_cutoff=datetime(2023, 9, 10, 15, 30), computed_at=COMPUTED,
    )
    assert result.__class__.__name__ == "Unprojectable"
    assert result.reason == "insufficient_history"
