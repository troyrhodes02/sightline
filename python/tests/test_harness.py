"""The chronological harness (SIG-17).

Runs a real backtest over a small fixture corpus and asserts the properties
that make a run trustworthy: chronological order, a cutoff that is always
before its own kickoff, a population that reconciles, baselines drawn from the
same eligible history as the model, and an incomplete run that cannot be read
as a result.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from sightline_ingest.asof import AsOfCorpus
from sightline_ingest.datasets._common import game_id, player_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle
from sightline_model import artifacts as art
from sightline_model import persist
from sightline_model.baselines import Baselines, season_average, trailing_five
from sightline_model.features import EligibleHistory
from sightline_model.harness import (
    RunConfig,
    derive_cutoff,
    run_backtest,
    validate_stat_types,
)

pytestmark = pytest.mark.db

WRS = [("00-0036900", "Rashee Rice"), ("00-0036901", "Justin Watson")]
GAMES = [f"2023_{w:02d}_DET_KC" for w in range(1, 6)]
GAMEDAYS = ["2023-09-10", "2023-09-17", "2023-09-24", "2023-10-01", "2023-10-08"]
PRIOR_GAMES = [f"2022_{w:02d}_DET_KC" for w in range(1, 4)]
PRIOR_GAMEDAYS = ["2022-09-11", "2022-09-18", "2022-09-25"]


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["KC", "DET"],
        "team_conf": ["AFC", "NFC"], "team_division": ["W", "N"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [g for g, _ in WRS],
        "display_name": [n for _, n in WRS],
        "position": ["WR", "WR"],
        "birth_date": ["2000-01-01", "1996-01-01"],
        "pfr_id": ["RiceRa00", "WatsJu00"],
    })


def _schedule_df() -> pl.DataFrame:
    ids = PRIOR_GAMES + GAMES
    days = PRIOR_GAMEDAYS + GAMEDAYS
    seasons = [2022] * len(PRIOR_GAMES) + [2023] * len(GAMES)
    weeks = list(range(1, len(PRIOR_GAMES) + 1)) + list(range(1, len(GAMES) + 1))
    n = len(ids)
    return pl.DataFrame({
        "game_id": ids, "season": seasons, "week": weeks,
        "game_type": ["REG"] * n, "gameday": days, "gametime": ["17:00"] * n,
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": ["outdoors"] * n,
        "stadium": ["Arrowhead"] * n, "location": ["Home"] * n, "result": [3] * n,
    })


def _stats_df() -> pl.DataFrame:
    rows = []
    for gsis, _ in WRS:
        for i, g in enumerate(PRIOR_GAMES):
            rows.append((gsis, g, 40.0 + 5 * i))
        for i, g in enumerate(GAMES):
            rows.append((gsis, g, 55.0 + 6 * i))
    n = len(rows)
    return pl.DataFrame({
        "player_id": [r[0] for r in rows], "game_id": [r[1] for r in rows],
        "team": ["KC"] * n,
        "passing_yards": [None] * n, "passing_tds": [None] * n,
        "attempts": [None] * n, "completions": [None] * n,
        "passing_interceptions": [None] * n,
        "rushing_yards": [2.0] * n, "rushing_tds": [0] * n, "carries": [1] * n,
        "receiving_yards": [r[2] for r in rows], "receiving_tds": [1] * n,
        "receptions": [4] * n, "targets": [6] * n,
    })


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2022, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2022, 2023, fetch=lambda s: _stats_df())
    return connect


@pytest.fixture
def artifact_base(tmp_path):
    return tmp_path / "artifacts"


def _config(artifact_base, **overrides) -> RunConfig:
    base = dict(
        season_from=2023, season_to=2023,
        stat_types=("receiving_yards",), season_types=("REG",),
        evaluation_window="development", artifact_base=artifact_base,
    )
    base.update(overrides)
    return RunConfig(**base)


# --- Cutoff policy -----------------------------------------------------------


def test_cutoff_is_ninety_minutes_before_kickoff(corpus) -> None:
    kickoff = datetime(2023, 10, 8, 21, 0)
    cutoff = derive_cutoff(
        AsOfCorpus(corpus, kickoff - timedelta(days=7)),
        game_id=game_id(GAMES[4]), kickoff=kickoff,
    )
    assert cutoff == kickoff - timedelta(minutes=90)
    assert cutoff < kickoff


def test_cutoff_takes_the_earlier_of_two_known_kickoffs(corpus) -> None:
    # `min` is deliberate: for a cutoff, resolving EARLIER is conservative.
    # A game flexed LATER must not hand the model an extra window.
    actual = datetime(2023, 10, 8, 21, 0)
    later = actual + timedelta(hours=4)

    class _Frame:
        height = 1

        def __getitem__(self, key):
            return [later]

    class _Corpus:
        def schedule_as_known(self, *, game_id):
            return _Frame()

    cutoff = derive_cutoff(_Corpus(), game_id="g", kickoff=actual)
    assert cutoff == actual - timedelta(minutes=90)


# --- A real run ---------------------------------------------------------------


def test_run_produces_artefacts_and_reconciles_its_population(
    corpus, artifact_base
) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)

    assert outcome.status == "ready", outcome.error
    totals = outcome.totals
    assert totals.candidates > 0
    assert (
        totals.projected + totals.unprojectable + totals.excluded
        == totals.candidates
    ), "a run that cannot account for its own candidates is not a result"
    assert totals.comparison <= totals.projected

    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    assert predictions.height == totals.projected
    thresholds = art.read_dataset(outcome.root, art.THRESHOLDS)
    assert thresholds.height == totals.threshold_observations
    assert art.is_complete(outcome.root)

    manifest = art.read_manifest(outcome.root)
    assert manifest["cutoffPolicy"] == "kickoff_minus_90m/v1"
    assert manifest["gradingTarget"] == "official_corrected"
    assert manifest["predictionsDigest"]


def test_no_prediction_was_computed_after_its_own_kickoff(
    corpus, artifact_base
) -> None:
    # The single most important assertion about a run.
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    late = predictions.filter(
        pl.col("information_cutoff") >= pl.col("kickoff_at")
    )
    assert late.height == 0, late


def test_predictions_carry_provenance_and_two_distinct_timestamps(
    corpus, artifact_base
) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    row = art.read_dataset(outcome.root, art.PREDICTIONS).to_dicts()[0]
    assert row["model_version"]
    assert row["information_cutoff"] != row["computed_at"]
    assert row["weather_era"] in {"archived_forecast", "reanalysis"}
    assert row["era_source"] in {"weather_row", "season_rule"}
    assert row["mass_below_zero"] == 0.0


def test_games_are_processed_chronologically(corpus, artifact_base) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    kickoffs = predictions["kickoff_at"].to_list()
    assert kickoffs == sorted(kickoffs)


def test_week_one_is_excluded_from_the_comparison_population_only(
    corpus, artifact_base
) -> None:
    # The season average is undefined before a player's first eligible game of
    # the season. The prediction survives; only the comparison drops it.
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    exclusions = art.read_dataset(outcome.root, art.EXCLUSIONS)

    week_one = predictions.filter(pl.col("week") == 1)
    assert week_one.height > 0
    assert not any(week_one["in_comparison_population"].to_list())
    assert week_one["baseline_season_avg"].null_count() == week_one.height
    # Retained in the model-only population, and accounted for by reason.
    assert "baseline_unavailable" in exclusions["reason"].to_list()


def test_exclusions_carry_reason_codes(corpus, artifact_base) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    exclusions = art.read_dataset(outcome.root, art.EXCLUSIONS)
    assert exclusions.height > 0
    assert set(exclusions["stage"].to_list()) <= {"engine", "harness"}
    assert all(r for r in exclusions["reason"].to_list())


def test_rerunning_the_same_config_reproduces_the_predictions_digest(
    corpus, artifact_base
) -> None:
    first = run_backtest(corpus, _config(artifact_base), persist=persist)
    second = run_backtest(corpus, _config(artifact_base), persist=persist)
    assert first.run_id != second.run_id, "experiment history is preserved"
    assert first.predictions_digest == second.predictions_digest


def test_seed_does_not_influence_the_result(corpus, artifact_base) -> None:
    # The engine is closed-form. Determinism is a property of the computation,
    # not of the seed, and this proves the seed is inert.
    a = run_backtest(corpus, _config(artifact_base, seed=1), persist=persist)
    b = run_backtest(corpus, _config(artifact_base, seed=999_999), persist=persist)
    assert a.predictions_digest == b.predictions_digest


def test_limit_games_bounds_the_run(corpus, artifact_base) -> None:
    outcome = run_backtest(
        corpus, _config(artifact_base, limit_games=2), persist=persist
    )
    predictions = art.read_dataset(outcome.root, art.PREDICTIONS)
    assert predictions["game_id"].n_unique() <= 2


# --- Run lifecycle -----------------------------------------------------------


def test_a_run_in_flight_is_not_a_readable_result(corpus, artifact_base) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    rows = persist.list_runs(corpus)
    stored = [r for r in rows if r.id == outcome.run_id][0]
    # Aggregation (SIG-18) is what completes a run: a completed run must carry
    # all three digests and two of them do not exist yet.
    assert stored.status == "running"
    assert stored.is_result is False


def test_reap_marks_abandoned_runs_interrupted_never_completed(
    corpus, artifact_base
) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    with corpus() as conn, conn.cursor() as cur:
        cur.execute(
            "update backtest_runs set started_at = now() - interval '48 hours' "
            "where id = %s", (outcome.run_id,),
        )
        conn.commit()

    assert persist.reap_stale_runs(corpus) == 1
    stored = [r for r in persist.list_runs(corpus) if r.id == outcome.run_id][0]
    assert stored.status == "interrupted"
    assert stored.is_result is False


def test_finish_run_refuses_to_complete_a_run(corpus, artifact_base) -> None:
    outcome = run_backtest(corpus, _config(artifact_base), persist=persist)
    with pytest.raises(ValueError, match="cannot complete"):
        persist.finish_run(
            corpus, outcome.run_id, status="completed",
            totals=outcome.totals, finished_at=datetime(2026, 7, 28, 14, 0),
        )


def test_unknown_stat_type_is_rejected_before_any_work() -> None:
    with pytest.raises(ValueError, match="unknown stat type"):
        validate_stat_types(["recieving_yards"])


# --- Baselines ---------------------------------------------------------------


def _history(values, seasons) -> EligibleHistory:
    return EligibleHistory(
        player_id="p", values=values, game_ids=[f"g{i}" for i in range(len(values))],
        kickoffs=[datetime(2023, 9, 10) for _ in values], seasons=seasons,
    )


def test_season_average_is_undefined_before_the_first_eligible_game() -> None:
    history = _history([61.0, 58.0], [2022, 2022])
    assert season_average(history, season=2023) is None
    # Not zero, and not last year's number wearing this year's label.


def test_season_average_uses_only_the_same_season() -> None:
    history = _history([100.0, 20.0, 40.0], [2022, 2023, 2023])
    assert season_average(history, season=2023) == pytest.approx(30.0)


def test_trailing_five_may_cross_a_season_boundary() -> None:
    history = _history([10.0, 20.0, 30.0, 40.0, 50.0], [2022, 2022, 2023, 2023, 2023])
    assert trailing_five(history) == pytest.approx(30.0)


def test_trailing_five_uses_at_most_five_games() -> None:
    history = _history([1.0] * 8 + [100.0], [2023] * 9)
    assert trailing_five(history) == pytest.approx((1.0 * 4 + 100.0) / 5)


def test_both_defined_requires_both() -> None:
    assert Baselines(1.0, 2.0).both_defined
    assert not Baselines(None, 2.0).both_defined
    assert not Baselines(1.0, None).both_defined
