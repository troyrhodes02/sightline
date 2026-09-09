"""Layer 3 of the Simulation Engine: the efficiency model.

Layer 1 says *how many plays a team runs*; Layer 2 says *who gets the
opportunity*. Layer 3 answers the last question in the football process: *what a
player does with an opportunity once he has it.* Given a draw's per-player
target and carry counts, this layer turns opportunity into a stat line —
receiving yards and receptions and receiving touchdowns; rushing yards and
rushing touchdowns; passing yards and passing touchdowns — one draw of the joint
game at a time. It is kept **strictly separate from usage** (RD-8): a role
change moves opportunity in Layer 2 without touching a player's per-opportunity
efficiency here, and an efficiency regression is diagnosable independently of an
allocation one.

This module owns three things:

* **The per-player efficiency parameters** (:class:`PlayerEfficiency`) — yards
  per target and catch rate (receiving), yards per carry (rushing), yards per
  pass attempt and pass-TD rate (passing), and a rush/rec TD rate per
  opportunity. Each is **shrunk toward a walk-forward POSITION prior** via the
  existing :mod:`sightline_model.priors` machinery, so a sparse player regresses
  to his position rather than to a lucky three-game sample. The prior is
  fitted from strictly-earlier seasons, so it cannot leak.
* **The model** (:class:`EfficiencyModel`) — fits per-player efficiency from an
  as-of history frame against those priors, and ``predict``/``save``/``load``
  exactly as the Layer 1 and Layer 2 models do (joblib, local import, artefact
  feature-list guard).
* **The simulation samplers** (:func:`sample_receiving`, :func:`sample_rushing`,
  :func:`sample_passing`) — given a ``(draw_count,)`` opportunity array, draw the
  stat line **vectorised across the whole draw axis** (no Python loop over
  draws). Receiving yards are ``Σ over targets`` of a per-target catch
  Bernoulli times a per-reception LogNormal yardage — realised as one big
  masked matrix reduced along the target axis, never a per-draw loop.
  Touchdowns are a low-rate Binomial per opportunity, which is what produces the
  large zero mass the PMF preserves.

Prices, recommendations, and edges are never imported here; the import-graph
guard sweeps this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..priors import Prior, shrink
from .config import DISCRETE_STAT_TYPES  # noqa: F401  (documents the count family)

# The efficiency feature vocabulary, in a fixed order so a fitted artefact and a
# live prediction can never disagree on column meaning. These are the trailing,
# per-opportunity rates a player's own history establishes; the model shrinks
# each toward its position prior.
EFFICIENCY_KEYS: tuple[str, ...] = (
    "yards_per_target",
    "catch_rate",
    "yards_per_carry",
    "yards_per_pass_attempt",
    "pass_td_rate",
    "rush_td_rate",
    "rec_td_rate",
)

# Floors mirroring the baseline's SIGMA_FLOOR intent: a lucky-tight per-player
# fit must never collapse a sampled yardage distribution to a spike, which the
# confidence rule downstream would then read as certainty. Log-scale dispersion
# for the per-reception / per-carry yardage LogNormal.
YARDAGE_SIGMA_FLOOR = 0.5
# Catch and TD rates are probabilities; clamp strictly inside (0, 1) so a
# Bernoulli/Binomial draw is always well defined.
RATE_FLOOR = 1e-4
RATE_CEIL = 1.0 - 1e-4


@dataclass(frozen=True)
class PlayerEfficiency:
    """One player's per-opportunity efficiency, all shrunk to position priors.

    Every field is a rate or a per-opportunity mean the simulation samples
    around. ``n_eff`` is the count of eligible opportunity-games behind the fit —
    the SAME role-history depth the confidence rule reads, never the draw count.
    A field may be ``None`` when its channel is irrelevant to the player (a wide
    receiver has no ``yards_per_pass_attempt``); the samplers guard against it.
    """

    player_id: str
    position: str | None
    n_eff: int

    # Receiving
    yards_per_target: float | None = None
    catch_rate: float | None = None
    rec_td_rate: float | None = None  # per target

    # Rushing
    yards_per_carry: float | None = None
    rush_td_rate: float | None = None  # per carry

    # Passing
    yards_per_pass_attempt: float | None = None
    pass_td_rate: float | None = None  # per pass attempt

    # Log-scale dispersion for the per-opportunity yardage LogNormal, one per
    # yardage channel. Shrunk like the means; floored so a spike-tight fit never
    # reads as certainty.
    rec_yards_sigma: float = YARDAGE_SIGMA_FLOOR
    rush_yards_sigma: float = YARDAGE_SIGMA_FLOOR
    pass_yards_sigma: float = YARDAGE_SIGMA_FLOOR


def _clamp_rate(value: float) -> float:
    return float(min(max(value, RATE_FLOOR), RATE_CEIL))


def _lognormal_params_from_mean(mean: float, sigma: float) -> tuple[float, float]:
    """(mu, sigma) of a LogNormal whose expectation is ``mean``.

    We parameterise the per-opportunity yardage by its arithmetic mean (what the
    efficiency history and the position prior naturally estimate) and a
    log-scale dispersion. ``E[LogNormal] = exp(mu + sigma^2/2)``, so
    ``mu = log(mean) - sigma^2/2``. A non-positive mean has no LogNormal fit; the
    caller floors it before we are reached.
    """
    sigma = max(sigma, YARDAGE_SIGMA_FLOOR)
    mu = float(np.log(max(mean, 1e-6)) - sigma * sigma / 2.0)
    return mu, sigma


# ---------------------------------------------------------------------------
# The model.
# ---------------------------------------------------------------------------


class EfficiencyModel:
    """Per-player efficiency with shrinkage to walk-forward position priors.

    Unlike Layers 1 and 2 this is not a gradient booster: efficiency is a
    per-player rate best estimated by *shrinking the player's own trailing rate
    toward his position*, exactly the mechanism the baseline already uses
    (:func:`sightline_model.priors.shrink`). A booster would relearn the
    positional structure the priors already carry and add a fitted artefact with
    nothing extra to say at this scale. The class still exposes
    ``predict``/``save``/``load`` so it composes with the harness and the sim
    core identically to its siblings; the "fit" is the set of position priors it
    carries, keyed by ``(position, efficiency_key)``.

    ``priors`` maps ``(position, efficiency_key) -> mean-valued Prior`` — a
    walk-forward prior whose ``mean`` is the position's per-opportunity rate,
    fitted from strictly-earlier seasons by the existing prior machinery so it
    cannot leak. Tests build small synthetic prior sets.
    """

    def __init__(self, priors: dict[tuple[str, str], Prior] | None = None) -> None:
        self._priors: dict[tuple[str, str], Prior] = dict(priors or {})

    def _prior_mean(self, position: str | None, key: str) -> float | None:
        prior = self._priors.get((position or "", key))
        return None if prior is None or prior.mean is None else float(prior.mean)

    def predict(self, history: "EfficiencyHistory") -> PlayerEfficiency:
        """Shrink a player's trailing efficiency toward his position prior.

        ``history`` carries the player's own trailing per-opportunity rates and
        the ``n_eff`` behind them (see :class:`EfficiencyHistory`). Each rate is
        shrunk with the baseline's ``shrink`` (prior weight in games, K0), so a
        one-game player is mostly his position and a well-established one is
        mostly himself — the honest answer the confidence rule then labels.
        """
        n = history.n_eff

        def shrunk(key: str, sample: float | None) -> float | None:
            prior_mean = self._prior_mean(history.position, key)
            if sample is None and prior_mean is None:
                return None
            if sample is None:
                # No own evidence in this channel: fall back to the position
                # prior entirely rather than fabricating a rate.
                return prior_mean
            if prior_mean is None:
                return sample
            return shrink(sample, n, prior_mean)

        ypt = shrunk("yards_per_target", history.yards_per_target)
        catch = shrunk("catch_rate", history.catch_rate)
        rec_td = shrunk("rec_td_rate", history.rec_td_rate)
        ypc = shrunk("yards_per_carry", history.yards_per_carry)
        rush_td = shrunk("rush_td_rate", history.rush_td_rate)
        ypa = shrunk("yards_per_pass_attempt", history.yards_per_pass_attempt)
        pass_td = shrunk("pass_td_rate", history.pass_td_rate)

        return PlayerEfficiency(
            player_id=history.player_id,
            position=history.position,
            n_eff=n,
            yards_per_target=ypt,
            catch_rate=None if catch is None else _clamp_rate(catch),
            rec_td_rate=None if rec_td is None else _clamp_rate(rec_td),
            yards_per_carry=ypc,
            rush_td_rate=None if rush_td is None else _clamp_rate(rush_td),
            yards_per_pass_attempt=ypa,
            pass_td_rate=None if pass_td is None else _clamp_rate(pass_td),
            rec_yards_sigma=max(history.rec_yards_sigma, YARDAGE_SIGMA_FLOOR),
            rush_yards_sigma=max(history.rush_yards_sigma, YARDAGE_SIGMA_FLOOR),
            pass_yards_sigma=max(history.pass_yards_sigma, YARDAGE_SIGMA_FLOOR),
        )

    # --- persistence ------------------------------------------------------

    def save(self, path: Path) -> None:
        """Persist the fitted priors to local disk (mirrors backtest artefacts).

        joblib ships with scikit-learn and is its recommended serialiser; the
        artefact is never served and never referenced by a URL, exactly like the
        Layer 1/2 models and the Parquet backtest outputs.
        """
        import joblib

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "priors": self._priors,
                "efficiency_keys": list(EFFICIENCY_KEYS),
            },
            path,
        )

    @classmethod
    def load(cls, path: Path) -> "EfficiencyModel":
        import joblib

        blob = joblib.load(Path(path))
        if list(blob.get("efficiency_keys", [])) != list(EFFICIENCY_KEYS):
            raise ValueError(
                "artefact efficiency keys do not match the current EFFICIENCY_KEYS; "
                "the model version and its stored artefact have diverged"
            )
        return cls(priors=blob["priors"])


@dataclass(frozen=True)
class EfficiencyHistory:
    """A player's trailing per-opportunity efficiency, as-of the cutoff.

    Assembled by the harness/sim core from ``AsOfCorpus`` trailing stats — the
    same publication-bounded, correction-rolled-back rows Layer 2 reads — never a
    season aggregate. ``n_eff`` is the eligible opportunity-game count, the
    role-history depth the confidence rule consumes. Any channel a player never
    used is ``None``; the model falls that channel back to the position prior.
    """

    player_id: str
    position: str | None
    n_eff: int
    yards_per_target: float | None = None
    catch_rate: float | None = None
    rec_td_rate: float | None = None
    yards_per_carry: float | None = None
    rush_td_rate: float | None = None
    yards_per_pass_attempt: float | None = None
    pass_td_rate: float | None = None
    rec_yards_sigma: float = YARDAGE_SIGMA_FLOOR
    rush_yards_sigma: float = YARDAGE_SIGMA_FLOOR
    pass_yards_sigma: float = YARDAGE_SIGMA_FLOOR


# ---------------------------------------------------------------------------
# The simulation-facing samplers.
# ---------------------------------------------------------------------------


def _yardage_from_counts(
    rng: np.random.Generator,
    *,
    counts: np.ndarray,
    mean_per_success: float,
    sigma: float,
) -> np.ndarray:
    """Sum of ``counts[d]`` i.i.d. per-success LogNormal yards, vectorised.

    ``counts`` is a ``(draw_count,)`` integer array of successes per draw (caught
    passes, carries). We materialise a single ``(draw_count, max_count)`` matrix
    of per-success yardage, mask the entries beyond each draw's own count to
    zero, and sum along the success axis — one masked reduction over a single
    matrix, **no Python loop over draws**. When every draw has zero successes the
    result is all zeros with no allocation.
    """
    draw_count = counts.shape[0]
    max_count = int(counts.max()) if counts.size else 0
    if max_count == 0:
        return np.zeros(draw_count, dtype=np.float64)
    mu, sigma = _lognormal_params_from_mean(mean_per_success, sigma)
    # One rectangular block of per-success yardage for the whole game.
    per_success = rng.lognormal(mean=mu, sigma=sigma, size=(draw_count, max_count))
    # Column j contributes only to draws whose count exceeds j.
    keep = np.arange(max_count)[None, :] < counts[:, None]
    return np.where(keep, per_success, 0.0).sum(axis=1)


def sample_receiving(
    rng: np.random.Generator,
    *,
    targets: np.ndarray,
    efficiency: PlayerEfficiency,
    draw_count: int,
) -> dict[str, np.ndarray]:
    """Per-draw receiving line from a target array, vectorised across draws.

    Returns ``{"receiving_yards", "receptions", "receiving_tds"}`` each a
    ``(draw_count,)`` array. Receptions are ``Binomial(targets, catch_rate)`` per
    draw — the catch Bernoulli summed over the draw's targets, done as one
    vectorised binomial draw over the whole axis. Receiving yards are the sum
    over *caught* passes of a per-reception LogNormal, and receiving touchdowns
    are ``Binomial(targets, rec_td_rate)`` — a low-rate binomial that leaves the
    large zero mass the PMF preserves. No Python loop over draws anywhere.
    """
    _require_axis(targets, draw_count, "targets")
    catch_rate = _clamp_rate(efficiency.catch_rate or 0.0)
    receptions = rng.binomial(targets, catch_rate)
    # Efficiency stores yards-per-TARGET (its natural per-opportunity rate); the
    # LogNormal yardage is per RECEPTION, and a target becomes a reception with
    # probability catch_rate, so yards-per-reception = yards_per_target /
    # catch_rate. The catch Bernoulli already thins targets to receptions, so
    # conditioning the per-reception mean on the catch keeps the expected total
    # equal to targets * yards_per_target.
    ypt = efficiency.yards_per_target or 0.0
    yards_per_reception = ypt / catch_rate if ypt > 0.0 else 0.0
    yards = _yardage_from_counts(
        rng,
        counts=receptions,
        mean_per_success=yards_per_reception,
        sigma=efficiency.rec_yards_sigma,
    )
    td_rate = _clamp_rate(efficiency.rec_td_rate or 0.0)
    tds = rng.binomial(targets, td_rate)
    return {
        "receiving_yards": yards,
        "receptions": receptions.astype(np.int64),
        "receiving_tds": tds.astype(np.int64),
    }


def sample_rushing(
    rng: np.random.Generator,
    *,
    carries: np.ndarray,
    efficiency: PlayerEfficiency,
    draw_count: int,
) -> dict[str, np.ndarray]:
    """Per-draw rushing line from a carry array, vectorised across draws.

    Returns ``{"rushing_yards", "rushing_tds"}``. Rushing yards are the sum over
    a draw's carries of a per-carry LogNormal (one masked matrix reduction, no
    per-draw loop); rushing touchdowns are ``Binomial(carries, rush_td_rate)`` —
    a low-rate binomial that leaves a large zero mass.
    """
    _require_axis(carries, draw_count, "carries")
    yards = _yardage_from_counts(
        rng,
        counts=carries.astype(np.int64),
        mean_per_success=efficiency.yards_per_carry or 0.0,
        sigma=efficiency.rush_yards_sigma,
    )
    td_rate = _clamp_rate(efficiency.rush_td_rate or 0.0)
    tds = rng.binomial(carries, td_rate)
    return {
        "rushing_yards": yards,
        "rushing_tds": tds.astype(np.int64),
    }


def sample_passing(
    rng: np.random.Generator,
    *,
    pass_attempts: np.ndarray,
    efficiency: PlayerEfficiency,
    draw_count: int,
) -> dict[str, np.ndarray]:
    """Per-draw passing line from a pass-attempt array, vectorised across draws.

    Returns ``{"passing_yards", "passing_tds"}``. A quarterback's pass attempts
    are the team's pass attempts for the draw (there is one passer per team in
    the V1). Passing yards are the sum over attempts of a per-attempt LogNormal;
    passing touchdowns are ``Binomial(pass_attempts, pass_td_rate)``. Both
    vectorised across the draw axis.
    """
    _require_axis(pass_attempts, draw_count, "pass_attempts")
    yards = _yardage_from_counts(
        rng,
        counts=pass_attempts.astype(np.int64),
        mean_per_success=efficiency.yards_per_pass_attempt or 0.0,
        sigma=efficiency.pass_yards_sigma,
    )
    td_rate = _clamp_rate(efficiency.pass_td_rate or 0.0)
    tds = rng.binomial(pass_attempts, td_rate)
    return {
        "passing_yards": yards,
        "passing_tds": tds.astype(np.int64),
    }


def _require_axis(arr: np.ndarray, draw_count: int, name: str) -> None:
    if draw_count <= 0:
        raise ValueError("draw_count must be positive")
    if arr.shape != (draw_count,):
        raise ValueError(f"{name} must be shape (draw_count,), got {arr.shape}")
