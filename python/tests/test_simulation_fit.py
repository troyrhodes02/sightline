"""Offline simulation-model fit (SIG-67/68/69 staging).

Proves the fit module assembles training rows from the SAME as-of assemblers the
prediction path uses, fits all three layers on a tiny corpus slice, and that the
saved artefacts round-trip through ``load_simulation_models`` and drive a valid
projection. The corpus is a tiny fixture (one matchup, a handful of players, a
few games), NOT a real multi-season run — the real fit is a human-run step.
"""

from __future__ import annotations

import polars as pl
import pytest

from sightline_ingest.datasets._common import game_id as _game_id
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.stats import ingest_stats
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.provenance import IngestRunHandle
from sightline_model.simulation.efficiency import EfficiencyModel
from sightline_model.simulation.fit import (
    fit_simulation_models,
    save_simulation_models,
)
from sightline_model.simulation.game_environment import (
    FEATURE_COLUMNS as ENV_FEATURES,
    GameEnvironmentModel,
)
from sightline_model.simulation.live import load_simulation_models
from sightline_model.simulation.usage_allocation import (
    FEATURE_COLUMNS as USAGE_FEATURES,
    UsageAllocationModel,
)

pytestmark = pytest.mark.db

PLAYERS = [
    ("00-0030000", "Pat Passer", "QB", "KC"),
    ("00-0031000", "Rashee Receiver", "WR", "KC"),
    ("00-0032000", "Wes Wideout", "WR", "KC"),
    ("00-0033000", "Ron Runner", "RB", "KC"),
    ("00-0034000", "Dan Dropback", "QB", "DET"),
    ("00-0035000", "Deon Deep", "WR", "DET"),
    ("00-0036000", "Ricky Rush", "RB", "DET"),
]
def _weekly_days(start_month: int, start_day: int, n: int, year: int) -> list[str]:
    from datetime import date, timedelta
    d0 = date(year, start_month, start_day)
    return [(d0 + timedelta(weeks=w)).isoformat() for w in range(n)]


# A larger slice than the backtest fixture: the histogram booster needs enough
# team-game rows to bin and fit. Sixteen 2023 games (32 env rows) clears that,
# with a full 2022 prior season so every player has trailing history.
GAMES = [f"2023_{w:02d}_DET_KC" for w in range(1, 17)]
GAMEDAYS = _weekly_days(9, 10, 16, 2023)
PRIOR_GAMES = [f"2022_{w:02d}_DET_KC" for w in range(1, 9)]
PRIOR_GAMEDAYS = _weekly_days(9, 11, 8, 2022)


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET"], "team_name": ["KC", "DET"],
        "team_conf": ["AFC", "NFC"], "team_division": ["W", "N"],
    })


def _players_df() -> pl.DataFrame:
    return pl.DataFrame({
        "gsis_id": [p[0] for p in PLAYERS],
        "display_name": [p[1] for p in PLAYERS],
        "position": [p[2] for p in PLAYERS],
        "birth_date": ["1996-01-01"] * len(PLAYERS),
        "pfr_id": [f"Pfr{i:05d}" for i in range(len(PLAYERS))],
    })


def _schedule_df() -> pl.DataFrame:
    ids = PRIOR_GAMES + GAMES
    days = PRIOR_GAMEDAYS + GAMEDAYS
    seasons = [2022] * len(PRIOR_GAMES) + [2023] * len(GAMES)
    weeks = list(range(1, len(PRIOR_GAMES) + 1)) + list(range(1, len(GAMES) + 1))
    n = len(ids)
    # Alternate the roof so ``is_dome`` is not a single-distinct-value feature
    # column (the histogram booster's binning needs >= 2 distinct values per
    # non-missing feature; the real corpus is naturally varied).
    roofs = ["dome" if k % 2 else "outdoors" for k in range(n)]
    return pl.DataFrame({
        "game_id": ids, "season": seasons, "week": weeks,
        "game_type": ["REG"] * n, "gameday": days, "gametime": ["17:00"] * n,
        "home_team": ["KC"] * n, "away_team": ["DET"] * n, "roof": roofs,
        "stadium": ["Arrowhead"] * n, "location": ["Home"] * n, "result": [3] * n,
    })


def _stat_row(gsis, gid, team, **kw):
    row = {
        "player_id": gsis, "game_id": gid, "team": team,
        "passing_yards": None, "passing_tds": None, "attempts": None,
        "completions": None, "passing_interceptions": None,
        "rushing_yards": None, "rushing_tds": None, "carries": None,
        "receiving_yards": None, "receiving_tds": None,
        "receptions": None, "targets": None,
    }
    row.update(kw)
    return row


def _stats_df() -> pl.DataFrame:
    rows: list[dict] = []
    all_games = list(zip(
        PRIOR_GAMES + GAMES,
        [2022] * len(PRIOR_GAMES) + [2023] * len(GAMES),
    ))
    # Volumes VARY week to week so the histogram booster has a learnable signal
    # (a constant target degenerates its internal binning); the real corpus is
    # naturally varied, this fixture reproduces that at small scale.
    for i, (gid, _season) in enumerate(all_games):
        wobble = i % 5
        rows.append(_stat_row(
            "00-0030000", gid, "KC",
            passing_yards=250.0 + 5 * i, passing_tds=2,
            attempts=30 + wobble, completions=20 + wobble,
        ))
        rows.append(_stat_row(
            "00-0031000", gid, "KC",
            receiving_yards=70.0 + 6 * i, receiving_tds=1,
            receptions=5 + (i % 3), targets=8 + (i % 3),
        ))
        rows.append(_stat_row(
            "00-0032000", gid, "KC",
            receiving_yards=35.0 + 3 * i, receiving_tds=0,
            receptions=3, targets=4 + (i % 2),
        ))
        rows.append(_stat_row(
            "00-0033000", gid, "KC",
            rushing_yards=60.0 + 4 * i, rushing_tds=1, carries=13 + wobble,
            receiving_yards=15.0, receiving_tds=0, receptions=2, targets=3,
        ))
        # DET carries real offensive volume too (a QB and a back), so both teams
        # produce non-degenerate, varied Layer-1 targets.
        rows.append(_stat_row(
            "00-0034000", gid, "DET",
            passing_yards=230.0 + 4 * i, passing_tds=1,
            attempts=28 + (i % 4), completions=18 + (i % 4),
        ))
        rows.append(_stat_row(
            "00-0035000", gid, "DET",
            receiving_yards=45.0 + 2 * i, receiving_tds=0,
            receptions=4, targets=6 + (i % 3),
        ))
        rows.append(_stat_row(
            "00-0036000", gid, "DET",
            rushing_yards=55.0 + 3 * i, rushing_tds=1, carries=12 + (i % 4),
        ))
    return pl.DataFrame(rows)


def _seed_weather(connect) -> None:
    """Varied, cutoff-visible weather for every game.

    Without weather, the game-environment feature frame's weather columns are
    entirely missing, which the histogram booster's binning cannot handle (an
    all-NaN feature has no distinct values to threshold). The real corpus always
    carries ingested weather; this reproduces that. ``known_at`` is set months
    before any kickoff so every game's cutoff sees it.
    """
    ids = PRIOR_GAMES + GAMES
    with connect() as conn, conn.cursor() as cur:
        for k, gid in enumerate(ids):
            cur.execute(
                "insert into game_weather (id, game_id, temperature_c, wind_kph, "
                "precipitation_mm, era, status, weather_source, valid_at, "
                "known_at, known_at_reconstructed, source, ingest_run_id) values "
                "(gen_random_uuid(), %s, %s, %s, %s, 'archived_forecast', "
                "'observed', 'x', '2022-01-01 12:00', '2022-01-01 12:00', true, "
                "'open_meteo', 'r') on conflict (game_id) do nothing",
                (_game_id(gid), 5.0 + (k % 6), 8.0 + (k % 5), float(k % 3)),
            )
        conn.commit()


@pytest.fixture
def corpus(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_players(_h("players"), connect, fetch=_players_df)
    ingest_schedule(_h("schedule"), connect, 2022, 2023, fetch=lambda s: _schedule_df())
    ingest_stats(_h("stats"), connect, 2022, 2023, fetch=lambda s: _stats_df())
    _seed_weather(connect)
    return connect


def test_fit_assembles_and_fits_all_three_layers(corpus) -> None:
    models = fit_simulation_models(corpus, seasons=(2023,))
    assert isinstance(models.game_environment, GameEnvironmentModel)
    assert isinstance(models.usage, UsageAllocationModel)
    assert isinstance(models.efficiency, EfficiencyModel)
    # The efficiency priors carry the receiving/rushing/passing rates the fit saw.
    priors = models.efficiency._priors
    assert ("QB", "yards_per_pass_attempt") in priors
    assert ("WR", "yards_per_target") in priors
    assert ("RB", "yards_per_carry") in priors
    assert priors[("WR", "yards_per_target")].mean is not None


def test_artifacts_round_trip_through_load(corpus, tmp_path) -> None:
    models = fit_simulation_models(corpus, seasons=(2023,))
    out = save_simulation_models(models, tmp_path / "simulation-models")
    for name in ("game_environment.joblib", "usage_allocation.joblib",
                 "efficiency.joblib"):
        assert (out / name).exists()

    reloaded = load_simulation_models(out)
    # The reloaded env/usage models predict identically to the in-memory ones
    # (the artefact feature-list guard passed, and the estimators round-tripped).
    assert isinstance(reloaded.game_environment, GameEnvironmentModel)
    assert isinstance(reloaded.usage, UsageAllocationModel)
    assert isinstance(reloaded.efficiency, EfficiencyModel)
    assert list(ENV_FEATURES) and list(USAGE_FEATURES)  # column lists intact
    # Efficiency priors survive the joblib round-trip.
    assert reloaded.efficiency._priors.keys() == models.efficiency._priors.keys()


def test_load_raises_when_an_artifact_is_missing(tmp_path) -> None:
    with pytest.raises(Exception):
        load_simulation_models(tmp_path / "does-not-exist")
