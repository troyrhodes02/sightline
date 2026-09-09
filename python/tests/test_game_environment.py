"""Layer 1 (game environment) unit tests — no database required.

Covers the model's fit/predict on a small synthetic frame, the vectorised
sampler's shape/reproducibility/within-game correlation, and the RD-8 MAE metric
on hand-computed values. The as-of-only feature-assembly guarantee is exercised
adversarially (with a database) in ``test_asof_leakage.py``; here we assert the
narrower structural fact that feature assembly reads nothing but the corpus.
"""

from __future__ import annotations

import inspect

import numpy as np
import polars as pl

from sightline_model.simulation import game_environment as ge
from sightline_model.simulation.game_environment import (
    FEATURE_COLUMNS,
    TARGET_COLUMNS,
    GameEnvironmentFeatures,
    GameEnvironmentModel,
    GameEnvironmentPrediction,
    TeamEnvironmentFeatures,
    game_environment_mae,
    sample_team_volumes,
)


def _synthetic_training_frame(n: int = 120) -> pl.DataFrame:
    """A small synthetic team-game training frame with a learnable signal.

    Pass attempts rise with trailing pass rate and plays; rush attempts fall with
    pass rate. The point is a fittable frame, not a realistic one — the real fit
    is a human-run offline step against the corpus.
    """
    rng = np.random.default_rng(7)
    plays = rng.uniform(55, 75, n)
    pass_rate = rng.uniform(0.45, 0.70, n)
    pace = plays / 130.0
    rest = rng.choice([6.0, 7.0, 10.0], n)
    dome = rng.choice([0.0, 1.0], n)
    temp = rng.uniform(-2, 28, n)
    wind = rng.uniform(0, 30, n)
    precip = rng.uniform(0, 5, n)
    home = rng.choice([0.0, 1.0], n)

    pass_att = plays * pass_rate + rng.normal(0, 2, n)
    rush_att = plays * (1 - pass_rate) + rng.normal(0, 2, n)
    return pl.DataFrame(
        {
            "trailing_plays_per_game": plays,
            "trailing_pass_rate": pass_rate,
            "trailing_pace_proxy": pace,
            "opp_trailing_plays_per_game": plays[::-1],
            "opp_trailing_pass_rate_allowed": pass_rate[::-1],
            "rest_days": rest,
            "is_dome": dome,
            "temperature_c": temp,
            "wind_kph": wind,
            "precipitation_mm": precip,
            "is_home": home,
            "pass_attempts": pass_att,
            "rush_attempts": rush_att,
        }
    )


def _features(home_pass_rate: float = 0.62, away_pass_rate: float = 0.50) -> GameEnvironmentFeatures:
    home = TeamEnvironmentFeatures(
        team_abbr="KC", is_home=True,
        trailing_plays_per_game=66.0, trailing_pass_rate=home_pass_rate,
        trailing_pace_proxy=66.0 / 130.0,
        opp_trailing_plays_per_game=62.0, opp_trailing_pass_rate_allowed=away_pass_rate,
        rest_days=7.0, is_dome=0.0, temperature_c=12.0, wind_kph=15.0,
        precipitation_mm=0.0,
    )
    away = TeamEnvironmentFeatures(
        team_abbr="DET", is_home=False,
        trailing_plays_per_game=62.0, trailing_pass_rate=away_pass_rate,
        trailing_pace_proxy=62.0 / 130.0,
        opp_trailing_plays_per_game=66.0, opp_trailing_pass_rate_allowed=home_pass_rate,
        rest_days=7.0, is_dome=0.0, temperature_c=12.0, wind_kph=15.0,
        precipitation_mm=0.0,
    )
    return GameEnvironmentFeatures(game_id="2023_01_DET_KC", teams=(home, away))


# --- Feature assembly reads only the corpus ---------------------------------


def test_assemble_features_takes_only_a_corpus() -> None:
    # The single-argument-plus-identity signature is the structural guarantee:
    # the function cannot open its own connection, so it inherits the cutoff. It
    # accepts an AsOfCorpus and game identity, never a DSN or a raw frame.
    sig = inspect.signature(ge.assemble_game_environment_features)
    params = list(sig.parameters)
    assert params[0] == "corpus"
    # No parameter smuggles in a raw frame or connection.
    assert not any(p in ("connect", "conn", "dsn", "frame", "df") for p in params)


# --- Model fits and predicts on a small synthetic frame ---------------------


def test_model_fits_and_predicts_positive_means() -> None:
    frame = _synthetic_training_frame()
    model = GameEnvironmentModel().fit(frame)
    preds = model.predict(_features())
    assert set(preds) == {"KC", "DET"}
    for pred in preds.values():
        assert pred.pass_attempts_mean > 0
        assert pred.rush_attempts_mean > 0
        assert pred.dispersion >= ge.DISPERSION_FLOOR
    # A pass-leaning team's predicted pass attempts exceed a run-leaning team's.
    lean = model.predict(_features(home_pass_rate=0.70, away_pass_rate=0.42))
    assert lean["KC"].pass_attempts_mean > lean["DET"].pass_attempts_mean


def test_model_persists_and_reloads(tmp_path) -> None:
    frame = _synthetic_training_frame()
    model = GameEnvironmentModel().fit(frame)
    path = tmp_path / "game_env.joblib"
    model.save(path)
    reloaded = GameEnvironmentModel.load(path)
    a = model.predict(_features())
    b = reloaded.predict(_features())
    for team in a:
        assert a[team].pass_attempts_mean == b[team].pass_attempts_mean
        assert a[team].rush_attempts_mean == b[team].rush_attempts_mean
        assert a[team].dispersion == b[team].dispersion


def test_predict_before_fit_raises() -> None:
    import pytest

    with pytest.raises(RuntimeError):
        GameEnvironmentModel().predict(_features())


def test_feature_frame_is_ordered_home_then_away() -> None:
    frame = _features().feature_frame()
    assert frame.columns == list(FEATURE_COLUMNS)
    assert frame.height == 2
    assert frame["is_home"].to_list() == [1.0, 0.0]  # home first


# --- Sampler: vectorised, reproducible, correlated --------------------------


def _predictions() -> dict[str, GameEnvironmentPrediction]:
    return {
        "KC": GameEnvironmentPrediction(pass_attempts_mean=38.0, rush_attempts_mean=26.0, dispersion=0.3),
        "DET": GameEnvironmentPrediction(pass_attempts_mean=32.0, rush_attempts_mean=28.0, dispersion=0.3),
    }


def test_sampler_is_vectorized_shape() -> None:
    rng = np.random.default_rng(123)
    draws = sample_team_volumes(rng, _predictions(), draw_count=5000)
    stacked = np.stack([draws["KC"], draws["DET"]])
    # A single NumPy draw axis of length draw_count, per team.
    assert stacked.shape == (2, 5000)
    assert draws["KC"].shape == (5000,)
    assert np.issubdtype(draws["KC"].dtype, np.integer)


def test_sampler_contains_no_python_loop_over_draws() -> None:
    # RD structural check: the sampler must not iterate per draw. It may loop
    # over the (two) teams, but never over range(draw_count) or per-draw.
    source = inspect.getsource(sample_team_volumes)
    assert "range(draw_count)" not in source
    assert "for _ in range" not in source


def test_sampler_is_reproducible_given_a_seeded_rng() -> None:
    a = sample_team_volumes(np.random.default_rng(42), _predictions(), draw_count=3000)
    b = sample_team_volumes(np.random.default_rng(42), _predictions(), draw_count=3000)
    for team in a:
        assert np.array_equal(a[team], b[team])


def test_shared_pace_latent_correlates_the_two_teams() -> None:
    # The shared game-pace latent should make the two teams' total volumes move
    # together: a high-tempo simulated game inflates both. Positive correlation
    # is the property the joint structure requires.
    rng = np.random.default_rng(2024)
    draws = sample_team_volumes(rng, _predictions(), draw_count=20000)
    corr = float(np.corrcoef(draws["KC"], draws["DET"])[0, 1])
    assert corr > 0.05, f"expected positive within-game correlation, got {corr}"


# --- Validation metric (RD-8) -----------------------------------------------


def test_game_environment_mae_on_hand_values() -> None:
    predicted = {
        "KC": GameEnvironmentPrediction(pass_attempts_mean=40.0, rush_attempts_mean=25.0, dispersion=0.3),
        "DET": GameEnvironmentPrediction(pass_attempts_mean=30.0, rush_attempts_mean=28.0, dispersion=0.3),
    }
    observed = {"KC": (38.0, 27.0), "DET": (33.0, 26.0)}
    result = game_environment_mae(predicted, observed)
    # KC plays: pred 65 vs obs 65 -> 0; DET plays: pred 58 vs obs 59 -> 1. mean = 0.5
    assert result["plays_mae"] == 0.5
    # split abs errors: KC pass |40-38|=2, KC rush |25-27|=2, DET pass |30-33|=3,
    # DET rush |28-26|=2  -> mean of [2,2,3,2] = 2.25
    assert result["pass_rush_split_mae"] == 2.25


def test_target_columns_are_the_two_attempts() -> None:
    assert TARGET_COLUMNS == ("pass_attempts", "rush_attempts")
