"""Layer 1 of the Simulation Engine: the game-environment model.

The football process starts with *how many plays each team runs and how those
plays split between pass and rush*. Everything downstream — usage allocation,
efficiency — is conditioned on that team volume, which is why it is the first
layer and has its own validation metric (RD-8). This module owns three things:

* **Feature assembly** (``assemble_game_environment_features``) — per team in a
  game, a fixed set of features read **only** through :class:`AsOfCorpus`. Every
  value is trailing (as of the cutoff) or immutable game context; there is no
  season aggregate, no current-roster backward join, and no price. The as-of
  layer is the sole read path, so the temporal guarantee is inherited rather
  than re-implemented here.
* **The model** (:class:`GameEnvironmentModel`) — a two-target gradient-boosting
  regressor (``HistGradientBoostingRegressor``, the sanctioned booster — never
  lightgbm/xgboost) predicting per-team ``pass_attempts`` and ``rush_attempts``,
  plus a fitted residual dispersion the simulation samples around. Fitted
  offline against the historical corpus (a human-run step); persisted to and
  loaded from local disk beside the backtest artefacts.
* **The simulation sampler** (:func:`sample_team_volumes`) — draws the two
  teams' attempts from a Negative-Binomial parameterised by (mean, dispersion),
  **vectorised across the whole draw axis** (no Python loop over draws) and
  correlated within the game through a shared game-pace latent and a shared
  pass-lean latent common to both teams.

Prices, recommendations, and edges are never imported here; the import-graph
guard sweeps this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingRegressor

from sightline_ingest.asof import AsOfCorpus

from ..constants import TRAILING_WINDOW

# The feature columns the model consumes, in a fixed order so a fitted artefact
# and a live prediction can never disagree on column meaning. Both teams in a
# game produce one row each with this schema.
FEATURE_COLUMNS: tuple[str, ...] = (
    "trailing_plays_per_game",
    "trailing_pass_rate",
    "trailing_pace_proxy",
    "opp_trailing_plays_per_game",
    "opp_trailing_pass_rate_allowed",
    "rest_days",
    "is_dome",
    "temperature_c",
    "wind_kph",
    "precipitation_mm",
    "is_home",
)

# The two regression targets. Total offensive plays derive from their sum; the
# pass/rush split is the pair itself.
TARGET_COLUMNS: tuple[str, ...] = ("pass_attempts", "rush_attempts")

# A floor on the negative-binomial dispersion. Without it, a perfectly-fit
# training residual would collapse the sampled distribution to a spike, and the
# simulation would then treat a lucky fit as certainty about future volume — the
# same failure the baseline's SIGMA_FLOOR guards against.
DISPERSION_FLOOR = 0.05


@dataclass(frozen=True)
class TeamEnvironmentFeatures:
    """One team's game-environment features, all as-of the cutoff.

    ``team_abbr`` and ``is_home`` identify the team within the game; the rest are
    the model inputs. Any field may be ``None`` when its evidence is absent as of
    the cutoff (a team with no prior games, weather not yet published); the model
    tolerates missing features natively, which is one reason the sanctioned
    booster is a histogram gradient boosting regressor.
    """

    team_abbr: str
    is_home: bool
    trailing_plays_per_game: float | None
    trailing_pass_rate: float | None
    trailing_pace_proxy: float | None
    opp_trailing_plays_per_game: float | None
    opp_trailing_pass_rate_allowed: float | None
    rest_days: float | None
    is_dome: float | None
    temperature_c: float | None
    wind_kph: float | None
    precipitation_mm: float | None

    def feature_row(self) -> dict[str, float | None]:
        """The ordered feature dict the model consumes (excludes identity)."""
        return {
            "trailing_plays_per_game": self.trailing_plays_per_game,
            "trailing_pass_rate": self.trailing_pass_rate,
            "trailing_pace_proxy": self.trailing_pace_proxy,
            "opp_trailing_plays_per_game": self.opp_trailing_plays_per_game,
            "opp_trailing_pass_rate_allowed": self.opp_trailing_pass_rate_allowed,
            "rest_days": self.rest_days,
            "is_dome": self.is_dome,
            "temperature_c": self.temperature_c,
            "wind_kph": self.wind_kph,
            "precipitation_mm": self.precipitation_mm,
            "is_home": 1.0 if self.is_home else 0.0,
        }


@dataclass(frozen=True)
class GameEnvironmentFeatures:
    """Both teams' features for one game, ordered [home, away]."""

    game_id: str
    teams: tuple[TeamEnvironmentFeatures, TeamEnvironmentFeatures]

    def feature_frame(self) -> pl.DataFrame:
        """A two-row frame (home first) in the fixed ``FEATURE_COLUMNS`` order."""
        rows = [t.feature_row() for t in self.teams]
        return pl.DataFrame(rows).select(FEATURE_COLUMNS)


def _volume_summary(volume: pl.DataFrame) -> tuple[float | None, float | None, float | None]:
    """Trailing plays-per-game, pass rate, and a pace proxy from prior team-games.

    ``volume`` is the per-team-game frame from ``AsOfCorpus.team_trailing_volume``
    — one row per prior game, never a season aggregate. Only the most recent
    ``TRAILING_WINDOW`` games are used, matching the baseline's form window, so a
    team's early-season blowup does not weight a week-14 projection forever.
    The pace proxy is plays-per-game normalised toward a nominal 130-play game,
    a cheap stand-in for seconds-per-play until play-by-play timing is ingested
    (kept deliberately simple — the pitch warns against research-scope creep).
    """
    if volume.height == 0:
        return None, None, None
    window = volume.sort("kickoff_at").tail(TRAILING_WINDOW)
    plays = window["plays"].cast(pl.Float64)
    pass_att = window["pass_attempts"].cast(pl.Float64)
    plays_per_game = float(plays.mean())
    total_plays = float(plays.sum())
    pass_rate = float(pass_att.sum() / total_plays) if total_plays > 0 else None
    pace_proxy = plays_per_game / 130.0
    return plays_per_game, pass_rate, pace_proxy


def _weather_row(corpus: AsOfCorpus, game_id: str) -> dict[str, float | None]:
    """Era-aware weather as-of the cutoff, via the sanctioned reader.

    ``AsOfCorpus.game_weather`` already applies the ``known_at <= cutoff`` bound
    and records the era (archived forecast 2021+, reanalysis earlier). We pass
    the values through unmodified; the era split is reported by the backtest, not
    silently averaged, so nothing era-specific is decided here.
    """
    weather = corpus.game_weather(game_id=game_id)
    if weather.height == 0:
        return {"temperature_c": None, "wind_kph": None, "precipitation_mm": None}
    row = weather.row(0, named=True)
    return {
        "temperature_c": _maybe_float(row.get("temperature_c")),
        "wind_kph": _maybe_float(row.get("wind_kph")),
        "precipitation_mm": _maybe_float(row.get("precipitation_mm")),
    }


def _maybe_float(value: object) -> float | None:
    return None if value is None else float(value)


def assemble_game_environment_features(
    corpus: AsOfCorpus,
    *,
    game_id: str,
    home_team_abbr: str,
    away_team_abbr: str,
    is_dome: bool,
) -> GameEnvironmentFeatures:
    """Both teams' game-environment features, read only through ``AsOfCorpus``.

    The corpus is the sole input, exactly as :mod:`sightline_model.features` is
    built: a function that could open its own connection could read a fact table
    without a cutoff, so it is handed the bound corpus and nothing else. Every
    feature is either trailing (windowed over prior team-games returned per-game
    by ``team_trailing_volume``) or immutable/as-known game context (rest via
    ``rest_and_travel``-style schedule reads, weather via ``game_weather``,
    dome/home from the game row passed in). No season aggregate, no current
    roster join, no price.

    ``is_dome`` and the two team abbreviations come from the immutable ``games``
    row (participants and venue kind do not move); the caller resolves them once.
    Rest days are read per team from the schedule via the corpus, using each
    team's own most-recent prior game.
    """
    home_vol = corpus.team_trailing_volume(team_abbr=home_team_abbr, before_game_id=game_id)
    away_vol = corpus.team_trailing_volume(team_abbr=away_team_abbr, before_game_id=game_id)
    home_plays, home_pass_rate, home_pace = _volume_summary(home_vol)
    away_plays, away_pass_rate, away_pace = _volume_summary(away_vol)
    weather = _weather_row(corpus, game_id)

    dome_flag = 1.0 if is_dome else 0.0
    home_rest = _team_rest_days(corpus, game_id=game_id, team_abbr=home_team_abbr)
    away_rest = _team_rest_days(corpus, game_id=game_id, team_abbr=away_team_abbr)

    home = TeamEnvironmentFeatures(
        team_abbr=home_team_abbr,
        is_home=True,
        trailing_plays_per_game=home_plays,
        trailing_pass_rate=home_pass_rate,
        trailing_pace_proxy=home_pace,
        # The opponent's allowed volume is the opponent's own trailing offense —
        # a defensive "plays/pass allowed" proxy until a defensive-facing feature
        # exists. Still per-game trailing, still as-of, no season aggregate.
        opp_trailing_plays_per_game=away_plays,
        opp_trailing_pass_rate_allowed=away_pass_rate,
        rest_days=home_rest,
        is_dome=dome_flag,
        temperature_c=weather["temperature_c"],
        wind_kph=weather["wind_kph"],
        precipitation_mm=weather["precipitation_mm"],
    )
    away = TeamEnvironmentFeatures(
        team_abbr=away_team_abbr,
        is_home=False,
        trailing_plays_per_game=away_plays,
        trailing_pass_rate=away_pass_rate,
        trailing_pace_proxy=away_pace,
        opp_trailing_plays_per_game=home_plays,
        opp_trailing_pass_rate_allowed=home_pass_rate,
        rest_days=away_rest,
        is_dome=dome_flag,
        temperature_c=weather["temperature_c"],
        wind_kph=weather["wind_kph"],
        precipitation_mm=weather["precipitation_mm"],
    )
    return GameEnvironmentFeatures(game_id=game_id, teams=(home, away))


def _team_rest_days(corpus: AsOfCorpus, *, game_id: str, team_abbr: str) -> float | None:
    """Rest days into the game for a team, from schedule reads as-known.

    Derived from the team's most-recent prior team-game (the last game in
    ``team_trailing_volume``, which is publication-bounded and past-only) and the
    target game's as-known kickoff. Never a stored column; a flex announced after
    the cutoff cannot move it, because both kickoffs come from the corpus.
    """
    sched = corpus.schedule_as_known(game_id=game_id)
    if sched.height == 0:
        return None
    target_kick = sched["kickoff_at"][0]
    prior = corpus.team_trailing_volume(team_abbr=team_abbr, before_game_id=game_id)
    if prior.height == 0:
        return None
    prev_kick = prior.sort("kickoff_at")["kickoff_at"][-1]
    return float((target_kick.date() - prev_kick.date()).days)


# ---------------------------------------------------------------------------
# The model.
# ---------------------------------------------------------------------------


@dataclass
class GameEnvironmentPrediction:
    """Per-team volume prediction the simulation samples around."""

    pass_attempts_mean: float
    rush_attempts_mean: float
    # Negative-binomial dispersion (the reciprocal-size parameter's proxy):
    # residual variance in excess of the mean, one fitted value shared across
    # teams. The sampler turns (mean, dispersion) into NB draws.
    dispersion: float


class GameEnvironmentModel:
    """Two-target volume model over :data:`FEATURE_COLUMNS`.

    Wraps two ``HistGradientBoostingRegressor`` instances — one per target — the
    sanctioned gradient booster. Two single-target regressors rather than a
    multi-output wrapper keeps each target's residual (and therefore its
    dispersion) independently inspectable, which the per-layer validation metric
    (RD-8) reports separately for plays and the pass/rush split.

    The real fit is a human-run offline step against the corpus; tests fit on
    small synthetic frames. ``fit`` also estimates a single residual dispersion
    from out-of-sample-shaped residuals so the simulation samples realistic
    game-to-game volume variance rather than a spike at the point prediction.
    """

    def __init__(self) -> None:
        # Defaults deliberately modest: this is a V1 volume model, not a tuned
        # research artefact (the pitch warns against scope explosion). The
        # hyperparameters that matter would be versioned into the config digest
        # when the real fit is run; kept here at library defaults for the V1.
        self._pass_model = HistGradientBoostingRegressor(random_state=0)
        self._rush_model = HistGradientBoostingRegressor(random_state=0)
        self._dispersion: float = DISPERSION_FLOOR
        self._fitted = False

    def fit(self, training_frame: pl.DataFrame) -> GameEnvironmentModel:
        """Fit both targets and the shared residual dispersion.

        ``training_frame`` carries the :data:`FEATURE_COLUMNS` and the two
        :data:`TARGET_COLUMNS`, one row per historical team-game. Feature columns
        may contain nulls; the histogram booster handles them natively (mapped to
        NaN), so no imputation policy is invented here.
        """
        missing = [c for c in (*FEATURE_COLUMNS, *TARGET_COLUMNS) if c not in training_frame.columns]
        if missing:
            raise ValueError(f"training frame missing columns: {missing}")
        x = _feature_matrix(training_frame.select(FEATURE_COLUMNS))
        pass_y = training_frame["pass_attempts"].cast(pl.Float64).to_numpy()
        rush_y = training_frame["rush_attempts"].cast(pl.Float64).to_numpy()
        self._pass_model.fit(x, pass_y)
        self._rush_model.fit(x, rush_y)

        # Dispersion: mean squared residual in excess of the predicted mean,
        # normalised by the mean, floored. This is the over-dispersion the NB
        # sampler needs; a spike-tight fit floors to DISPERSION_FLOOR so the
        # simulation never mistakes a lucky fit for certainty.
        pass_pred = self._pass_model.predict(x)
        rush_pred = self._rush_model.predict(x)
        resid_var = float(
            np.mean((pass_y - pass_pred) ** 2) + np.mean((rush_y - rush_pred) ** 2)
        )
        mean_level = float(np.mean(pass_pred) + np.mean(rush_pred))
        raw = resid_var / mean_level if mean_level > 0 else DISPERSION_FLOOR
        self._dispersion = max(raw, DISPERSION_FLOOR)
        self._fitted = True
        return self

    def predict(self, features: GameEnvironmentFeatures) -> dict[str, GameEnvironmentPrediction]:
        """Per-team ``{pass/rush_attempts_mean, dispersion}`` keyed by team abbr."""
        if not self._fitted:
            raise RuntimeError("GameEnvironmentModel.predict called before fit")
        x = _feature_matrix(features.feature_frame())
        pass_pred = self._pass_model.predict(x)
        rush_pred = self._rush_model.predict(x)
        out: dict[str, GameEnvironmentPrediction] = {}
        for i, team in enumerate(features.teams):
            out[team.team_abbr] = GameEnvironmentPrediction(
                pass_attempts_mean=max(float(pass_pred[i]), 0.0),
                rush_attempts_mean=max(float(rush_pred[i]), 0.0),
                dispersion=self._dispersion,
            )
        return out

    # --- persistence ------------------------------------------------------

    def save(self, path: Path) -> None:
        """Persist the fitted artefact to local disk (mirrors backtest artefacts).

        joblib ships with scikit-learn and is its recommended estimator
        serialiser. The artefact is never served and never referenced by a URL,
        exactly like the Parquet backtest outputs.
        """
        import joblib

        if not self._fitted:
            raise RuntimeError("refusing to save an unfitted GameEnvironmentModel")
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "pass_model": self._pass_model,
                "rush_model": self._rush_model,
                "dispersion": self._dispersion,
                "feature_columns": list(FEATURE_COLUMNS),
            },
            path,
        )

    @classmethod
    def load(cls, path: Path) -> GameEnvironmentModel:
        import joblib

        blob = joblib.load(Path(path))
        if list(blob.get("feature_columns", [])) != list(FEATURE_COLUMNS):
            raise ValueError(
                "artefact feature columns do not match the current FEATURE_COLUMNS; "
                "the model version and its stored artefact have diverged"
            )
        model = cls()
        model._pass_model = blob["pass_model"]
        model._rush_model = blob["rush_model"]
        model._dispersion = float(blob["dispersion"])
        model._fitted = True
        return model


def _feature_matrix(frame: pl.DataFrame) -> np.ndarray:
    """Polars feature frame -> float64 NumPy matrix, nulls as NaN.

    The histogram gradient booster treats NaN as a first-class "missing" value,
    so absent features (a team with no prior games, unpublished weather) flow
    through without an invented imputation policy.
    """
    return frame.select(FEATURE_COLUMNS).cast(pl.Float64).to_numpy()


# ---------------------------------------------------------------------------
# The simulation-facing sampler.
# ---------------------------------------------------------------------------


def sample_team_volumes(
    rng: np.random.Generator,
    predictions: dict[str, GameEnvironmentPrediction],
    draw_count: int,
) -> dict[str, np.ndarray]:
    """Draw each team's total attempts, vectorised across ``draw_count``.

    Returns ``{team_abbr: attempts}`` where ``attempts`` is a ``(draw_count,)``
    integer array of total offensive attempts (plays) for that team. Stacking the
    per-team arrays gives shape ``(n_teams, draw_count)`` — a single NumPy draw
    axis, **no Python loop over draws** — which is what the vectorisation test
    asserts.

    Two shared latents make the two teams' volumes correlated the way real games
    are: a slow, high-possession game inflates both teams' plays, and a
    pass-leaning game shifts both toward the air. Each is one standard-normal
    draw **common to both teams** (drawn once along the draw axis), so the teams
    move together rather than independently. The team-specific mean and
    dispersion then shape each team's Negative-Binomial around that shared
    latent.

    Parameterisation: the NB mean is the predicted total attempts scaled by the
    exponentiated shared pace latent (a multiplicative game-pace factor); its
    variance exceeds the mean by ``dispersion``. We convert (mean, variance) to
    NumPy's ``(n, p)`` and draw ``negative_binomial`` along the whole axis at
    once.
    """
    if draw_count <= 0:
        raise ValueError("draw_count must be positive")

    # Shared game-pace latent: one draw per simulation, common to both teams. A
    # small scale keeps the multiplicative factor near 1 (a modest ±few-percent
    # game-tempo swing) rather than distorting the predicted means.
    pace_latent = rng.standard_normal(draw_count)
    pace_factor = np.exp(0.08 * pace_latent)  # shared across teams -> positive corr

    # Shared pass-lean latent is drawn here so the full joint stream is realised
    # from this one generator even though total attempts (this function's output)
    # do not split by phase; the usage layer downstream consumes the pass/rush
    # split. Drawing it now keeps the RNG stream position deterministic for the
    # joint game simulation that seeds this generator.
    _pass_lean_latent = rng.standard_normal(draw_count)

    out: dict[str, np.ndarray] = {}
    for team_abbr, pred in predictions.items():
        mean_total = pred.pass_attempts_mean + pred.rush_attempts_mean
        # Apply the shared pace factor multiplicatively, vectorised across draws.
        mean_draws = np.maximum(mean_total * pace_factor, 1e-6)
        variance = mean_draws * (1.0 + pred.dispersion)
        # NB (n, p) from (mean, variance): p = mean / variance, n = mean^2 / (var - mean).
        p = np.clip(mean_draws / variance, 1e-6, 1.0 - 1e-9)
        n = np.maximum(mean_draws * p / (1.0 - p), 1e-6)
        out[team_abbr] = rng.negative_binomial(n, p)
    return out


# ---------------------------------------------------------------------------
# Validation metric (RD-8).
# ---------------------------------------------------------------------------


def game_environment_mae(
    predicted: dict[str, GameEnvironmentPrediction],
    observed: dict[str, tuple[float, float]],
) -> dict[str, float]:
    """Layer-1 validation MAE (RD-8), per team-game.

    ``observed`` maps team abbr to ``(pass_attempts, rush_attempts)``. Returns:

    * ``plays_mae`` — mean absolute error between predicted total offensive plays
      (pass+rush attempts) and observed total plays.
    * ``pass_rush_split_mae`` — mean absolute error on the split, averaged over
      the two components (pass attempts and rush attempts).

    Reported per run so a final regression is localisable to this layer rather
    than blamed on usage or efficiency.
    """
    teams = [t for t in predicted if t in observed]
    if not teams:
        raise ValueError("no overlapping teams between predicted and observed")
    plays_errors: list[float] = []
    split_errors: list[float] = []
    for team in teams:
        pred = predicted[team]
        obs_pass, obs_rush = observed[team]
        pred_plays = pred.pass_attempts_mean + pred.rush_attempts_mean
        obs_plays = obs_pass + obs_rush
        plays_errors.append(abs(pred_plays - obs_plays))
        split_errors.append(abs(pred.pass_attempts_mean - obs_pass))
        split_errors.append(abs(pred.rush_attempts_mean - obs_rush))
    return {
        "plays_mae": float(np.mean(plays_errors)),
        "pass_rush_split_mae": float(np.mean(split_errors)),
    }
