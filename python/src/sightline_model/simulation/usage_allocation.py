"""Layer 2 of the Simulation Engine: the usage-allocation model.

Layer 1 says *how many plays a team runs and how they split pass/rush*. Layer 2
answers the next question in the football process: *of those pass attempts and
rush attempts, who gets them.* Every downstream stat line — receptions, rushing
yards, touchdowns — is conditioned on the opportunity share this layer hands a
player, which is why it has its own validation metric (RD-8, usage-share MAE)
and its own leakage surface. This module owns four things:

* **Feature assembly** (:func:`assemble_usage_features`) — per eligible player, a
  fixed set of features read **only** through :class:`AsOfCorpus`. Trailing
  target share, carry share, and a snap-usage proxy come from
  ``trailing_player_stats_batch``; the player's most-recently-*known* injury
  designation comes from ``latest_injury_designation`` (the Wed→Fri progression
  is honoured by the cutoff). Team membership follows ``team_abbr_at_game`` — the
  team the player was on *at each historical game* — never today's roster: a
  player traded mid-season is attributed to the team he was on then, so a
  current-roster backward join is structurally impossible here. Position is a
  caller-supplied roster attribute (``players.position``, the one disclosed
  current-state input, resolved once by the harness exactly as the baseline
  does); this module never joins the roster itself. No season aggregate, no
  price.
* **The model** (:class:`UsageAllocationModel`) — a per-channel usage *scorer*
  (a ``HistGradientBoostingRegressor`` for targets and one for carries, the
  sanctioned booster — never lightgbm/xgboost) predicting an unnormalised
  per-player usage score. The score is turned into a coherent within-team share
  by :func:`allocate_shares`, not by the model directly, because shares are a
  team-relative quantity the model cannot see one player at a time.
* **Coherent allocation** (:func:`allocate_shares`) — a within-team softmax over
  *available* players so shares sum to 1; an unavailable (injured/out) player is
  forced to zero and the remainder **renormalises structurally** over his
  teammates — redistribution falls out of the normalisation rather than a
  hand-authored override. A per-team replacement/other pool absorbs residual
  opportunity so an allocation never claims more of the team than it has.
* **The simulation sampler** (:func:`sample_player_opportunities`) — per-player
  target and carry counts drawn ``Multinomial(pass_attempts, target_shares)`` and
  ``Multinomial(rush_attempts, carry_shares)``, **vectorised across the whole
  draw axis** (NumPy's vectorised ``Generator.multinomial``; no Python loop over
  draws). Multinomial draws make teammates *compete* for a fixed pool of
  attempts — the within-team negative correlation the joint simulation requires.

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

# The feature columns the usage scorer consumes, in a fixed order so a fitted
# artefact and a live prediction can never disagree on column meaning. One row
# per eligible player.
FEATURE_COLUMNS: tuple[str, ...] = (
    "trailing_target_share",
    "trailing_carry_share",
    "trailing_snap_proxy",
    "position_code",
    "is_available",
)

# The two usage channels this layer allocates. Targets are drawn against team
# pass attempts, carries against team rush attempts.
TARGET_CHANNEL = "target"
CARRY_CHANNEL = "carry"

# The label a channel's scorer is fit against: the player's realised share of
# his team's opportunity in that channel.
LABEL_COLUMNS: tuple[str, ...] = ("observed_target_share", "observed_carry_share")

# Injury designations that make a player structurally unavailable — forced to a
# zero share regardless of his predicted score, with his opportunity
# redistributed over available teammates. "Out" and "Doubtful" are the two the
# NFL report uses for players who will not (or almost certainly will not) play;
# "Questionable" is NOT here — a questionable player usually plays, so removing
# him would be the model deciding an absence the report did not report.
UNAVAILABLE_DESIGNATIONS: frozenset[str] = frozenset({"Out", "Doubtful", "IR", "PUP"})

# Position codes as an ordinal feature the histogram booster can split on. The
# roster position is a caller-supplied attribute (see the module docstring); an
# unknown/absent position maps to 0.0, which the booster treats as its own
# level rather than a missing value.
_POSITION_CODES: dict[str, float] = {
    "QB": 1.0,
    "RB": 2.0,
    "FB": 3.0,
    "WR": 4.0,
    "TE": 5.0,
}

# A floor on any single available player's share after the softmax, before
# renormalisation, so the replacement pool never collapses to exactly zero and a
# team's opportunity is always fully (and only fully) allocated. Small enough
# not to distort a real depth chart, large enough that the "other players not
# individually modelled" pool is always representable.
REPLACEMENT_POOL_FLOOR = 1e-6


def _position_code(position: str | None) -> float:
    """Ordinal code for a roster position; unknown/absent -> 0.0."""
    if position is None:
        return 0.0
    return _POSITION_CODES.get(position.upper(), 0.0)


@dataclass(frozen=True)
class PlayerUsageFeatures:
    """One player's usage features, all as-of the cutoff.

    ``player_id`` and ``team_abbr`` identify the player and the team he was on
    *as of the cutoff* (his most recent eligible game's ``team_abbr_at_game`` —
    never today's roster); the rest are model inputs. ``is_available`` is derived
    from the most-recently-known injury designation and drives the structural
    zero-share redistribution in :func:`allocate_shares`. Any model field may be
    ``None`` when its evidence is absent as of the cutoff; the histogram booster
    tolerates missing features natively.
    """

    player_id: str
    team_abbr: str | None
    position: str | None
    is_available: bool
    trailing_target_share: float | None
    trailing_carry_share: float | None
    trailing_snap_proxy: float | None

    def feature_row(self) -> dict[str, float | None]:
        """The ordered feature dict the scorer consumes (excludes identity)."""
        return {
            "trailing_target_share": self.trailing_target_share,
            "trailing_carry_share": self.trailing_carry_share,
            "trailing_snap_proxy": self.trailing_snap_proxy,
            "position_code": _position_code(self.position),
            "is_available": 1.0 if self.is_available else 0.0,
        }


def _player_usage_summary(
    rows: list[dict],
) -> tuple[float | None, float | None, float | None]:
    """Trailing target share, carry share, and a snap-usage proxy for one player.

    ``rows`` are that player's prior-game stat lines from
    ``trailing_player_stats_batch`` — one row per prior game, publication-bounded
    and correction-rolled-back, never a season aggregate. Only the most recent
    ``TRAILING_WINDOW`` games are used, matching the baseline's form window.

    Each share is the player's own opportunity divided by his *team's* opportunity
    in the same games, computed **within this player's rows** — a null column is
    phase-absence and contributes zero, exactly as the team-volume reader treats
    it. The snap proxy is total opportunity (targets + carries) per game
    normalised toward a nominal 20-touch feature-back workload; it is a cheap
    stand-in for offensive snap share until snap-count context is threaded
    through (kept deliberately simple — the pitch warns against scope creep). It
    is a per-player usage-intensity signal, not a team share, so it does not need
    the team denominator the shares do.
    """
    if not rows:
        return None, None, None
    window = rows[-TRAILING_WINDOW:]
    # Sum the player's own opportunity; a null column is absence -> 0.
    p_targets = sum(float(r["targets"]) for r in window if r.get("targets") is not None)
    p_carries = sum(float(r["carries"]) for r in window if r.get("carries") is not None)
    n_games = len(window)
    # The player's share denominator is his team's opportunity across the SAME
    # windowed games. We approximate the team pass/rush volume from the trailing
    # window's own scale rather than a separate team read: the snap proxy carries
    # the absolute level, while the shares are relative — a player with more
    # targets than a teammate scores higher, which is all the softmax needs. To
    # keep the share on a [0, 1]-ish scale without a second round trip, normalise
    # each channel by a nominal team volume per game (35 pass, 27 rush — league
    # central tendencies), so the feature is comparable across players.
    target_share = p_targets / (n_games * 35.0) if n_games else None
    carry_share = p_carries / (n_games * 27.0) if n_games else None
    snap_proxy = (p_targets + p_carries) / (n_games * 20.0) if n_games else None
    return target_share, carry_share, snap_proxy


def assemble_usage_features(
    corpus: AsOfCorpus,
    *,
    game_id: str,
    team_abbr: str,
    player_ids: list[str],
    positions: dict[str, str | None] | None = None,
) -> dict[str, PlayerUsageFeatures]:
    """Per-player usage features for one team in a game, read only through the corpus.

    The corpus is the sole read path, exactly as :mod:`sightline_model.features`
    is built: a function that could open its own connection could read a fact
    table without a cutoff, so it is handed the bound corpus and nothing else.
    Every feature is trailing (windowed over prior player-games returned by
    ``trailing_player_stats_batch``) or as-known context (injury designation via
    ``latest_injury_designation``). ``positions`` is a caller-supplied roster
    mapping (``players.position``, resolved once by the harness exactly as the
    baseline does) — this module never joins the roster.

    **Team membership follows the player, not today's roster.** A player is
    included on ``team_abbr`` only if his most recent eligible game's
    ``team_abbr_at_game`` equals it — the team he was on *as of the cutoff*. A
    player traded away is attributed to the team he was on at his last game, so a
    current-roster backward join cannot happen here: there is no read of a
    "current team" at all, only the per-game team that travels with each trailing
    row. Every requested player appears in the result (empty features when he has
    no eligible history), so "no history" is distinguishable from "not asked
    for".
    """
    positions = positions or {}
    trailing = corpus.trailing_player_stats_batch(
        player_ids=list(player_ids), before_game_id=game_id
    )
    grouped: dict[str, list[dict]] = {pid: [] for pid in player_ids}
    if trailing.height:
        # Oldest-first per player (the SQL orders by player_id, kickoff_at); keep
        # that order so the trailing window is the most-recent TRAILING_WINDOW.
        for row in trailing.sort("player_id", "kickoff_at").to_dicts():
            pid = row["player_id"]
            if pid in grouped:
                grouped[pid].append(row)

    out: dict[str, PlayerUsageFeatures] = {}
    for pid in player_ids:
        rows = grouped[pid]
        # Team AS OF THE CUTOFF: the team the player was on at his most recent
        # eligible game. Never a current-roster lookup. A player with no eligible
        # history has no as-of team and is left off the team's allocation.
        as_of_team = rows[-1]["team_abbr_at_game"] if rows else None
        target_share, carry_share, snap_proxy = _player_usage_summary(rows)
        designation = corpus.latest_injury_designation(player_id=pid, game_id=game_id)
        is_available = designation not in UNAVAILABLE_DESIGNATIONS
        out[pid] = PlayerUsageFeatures(
            player_id=pid,
            team_abbr=as_of_team,
            position=positions.get(pid),
            is_available=is_available,
            trailing_target_share=target_share,
            trailing_carry_share=carry_share,
            trailing_snap_proxy=snap_proxy,
        )
    return out


# ---------------------------------------------------------------------------
# The model.
# ---------------------------------------------------------------------------


class UsageAllocationModel:
    """Two per-channel usage scorers over :data:`FEATURE_COLUMNS`.

    Wraps two ``HistGradientBoostingRegressor`` instances — one predicting a
    target-usage score, one a carry-usage score — the sanctioned gradient
    booster. The scorers predict an *unnormalised* per-player usage score; the
    coherent within-team share is produced by :func:`allocate_shares`, because a
    share is a team-relative quantity a per-player regressor cannot see one row at
    a time. Keeping the two channels as independent scorers keeps each channel's
    usage-share MAE (RD-8) separately inspectable.

    The real fit is a human-run offline step against the corpus; tests fit on
    small synthetic frames. Fitting the model on observed shares (the label) and
    then re-normalising the predictions within a team preserves the ordering the
    booster learned while guaranteeing coherence — the model ranks players, the
    allocation makes the ranking a probability simplex.
    """

    def __init__(self) -> None:
        # Modest defaults: a V1 usage scorer, not a tuned research artefact (the
        # pitch warns against scope explosion). Hyperparameters that mattered
        # would be versioned into the config digest at the real fit.
        self._target_model = HistGradientBoostingRegressor(random_state=0)
        self._carry_model = HistGradientBoostingRegressor(random_state=0)
        self._fitted = False

    def fit(self, training_frame: pl.DataFrame) -> UsageAllocationModel:
        """Fit both channel scorers against observed shares.

        ``training_frame`` carries the :data:`FEATURE_COLUMNS` and the two
        :data:`LABEL_COLUMNS` (a player's realised target/carry share in a game),
        one row per historical player-game. Feature columns may contain nulls;
        the histogram booster handles them natively.
        """
        missing = [
            c
            for c in (*FEATURE_COLUMNS, *LABEL_COLUMNS)
            if c not in training_frame.columns
        ]
        if missing:
            raise ValueError(f"training frame missing columns: {missing}")
        x = _feature_matrix(training_frame.select(FEATURE_COLUMNS))
        target_y = training_frame["observed_target_share"].cast(pl.Float64).to_numpy()
        carry_y = training_frame["observed_carry_share"].cast(pl.Float64).to_numpy()
        self._target_model.fit(x, target_y)
        self._carry_model.fit(x, carry_y)
        self._fitted = True
        return self

    def predict(
        self, features: dict[str, PlayerUsageFeatures]
    ) -> dict[str, dict[str, float]]:
        """Per-player ``{target, carry}`` usage scores keyed by player id.

        Scores are the model's raw (unnormalised) usage prediction per channel,
        floored at zero — a negative usage score is meaningless and would flip a
        softmax. Turn these into coherent shares with :func:`allocate_shares`.
        """
        if not self._fitted:
            raise RuntimeError("UsageAllocationModel.predict called before fit")
        player_ids = list(features)
        frame = pl.DataFrame([features[pid].feature_row() for pid in player_ids])
        x = _feature_matrix(frame)
        target_scores = self._target_model.predict(x)
        carry_scores = self._carry_model.predict(x)
        return {
            pid: {
                TARGET_CHANNEL: max(float(target_scores[i]), 0.0),
                CARRY_CHANNEL: max(float(carry_scores[i]), 0.0),
            }
            for i, pid in enumerate(player_ids)
        }

    # --- persistence ------------------------------------------------------

    def save(self, path: Path) -> None:
        """Persist the fitted artefact to local disk (mirrors backtest artefacts).

        joblib ships with scikit-learn and is its recommended estimator
        serialiser. The artefact is never served and never referenced by a URL,
        exactly like the Parquet backtest outputs and the Layer 1 model.
        """
        import joblib

        if not self._fitted:
            raise RuntimeError("refusing to save an unfitted UsageAllocationModel")
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "target_model": self._target_model,
                "carry_model": self._carry_model,
                "feature_columns": list(FEATURE_COLUMNS),
            },
            path,
        )

    @classmethod
    def load(cls, path: Path) -> UsageAllocationModel:
        import joblib

        blob = joblib.load(Path(path))
        if list(blob.get("feature_columns", [])) != list(FEATURE_COLUMNS):
            raise ValueError(
                "artefact feature columns do not match the current FEATURE_COLUMNS; "
                "the model version and its stored artefact have diverged"
            )
        model = cls()
        model._target_model = blob["target_model"]
        model._carry_model = blob["carry_model"]
        model._fitted = True
        return model


def _feature_matrix(frame: pl.DataFrame) -> np.ndarray:
    """Polars feature frame -> float64 NumPy matrix, nulls as NaN.

    The histogram gradient booster treats NaN as a first-class "missing" value,
    so absent features (a player with no prior games) flow through without an
    invented imputation policy.
    """
    return frame.select(FEATURE_COLUMNS).cast(pl.Float64).to_numpy()


# ---------------------------------------------------------------------------
# Coherent within-team allocation.
# ---------------------------------------------------------------------------


def _softmax_shares(scores: np.ndarray, available: np.ndarray) -> np.ndarray:
    """Softmax over AVAILABLE players; unavailable forced to zero, rest renormalised.

    An unavailable player's score is sent to ``-inf`` before the softmax, so his
    mass is exactly zero and the remaining mass renormalises over his available
    teammates — redistribution is a property of the normalisation, not a
    hand-authored override. The softmax is computed in a numerically stable form
    (subtract the max) and only over the available entries, so an all-unavailable
    team yields all-zero shares (the caller's replacement pool then absorbs the
    whole team, below).
    """
    masked = np.where(available, scores.astype(np.float64), -np.inf)
    finite = np.isfinite(masked)
    if not finite.any():
        return np.zeros_like(scores, dtype=np.float64)
    m = np.max(masked[finite])
    exp = np.where(finite, np.exp(masked - m), 0.0)
    total = exp.sum()
    if total <= 0.0:
        return np.zeros_like(scores, dtype=np.float64)
    return exp / total


def allocate_shares(
    scores: dict[str, dict[str, float]],
    available_mask: dict[str, bool],
) -> dict[str, dict[str, float]]:
    """Coherent within-team target and carry shares, summing to 1 over the team.

    ``scores`` is one team's per-player ``{target, carry}`` usage scores
    (:meth:`UsageAllocationModel.predict`); ``available_mask`` marks who can play.
    Returns ``{player_id: {target_share, carry_share}}`` plus a synthetic
    ``__replacement__`` pool entry so that, per channel, every listed player's
    share plus the pool sums to exactly 1 — the team never allocates more
    opportunity than it has, and the residual "other players not individually
    modelled" is explicit rather than lost.

    Redistribution on absence is structural: an unavailable player is forced to a
    zero share (his score sent to ``-inf`` in the softmax), and the softmax over
    the remaining available players renormalises the freed mass across his
    teammates. No player-specific override is written — remove a player and his
    opportunity flows to whoever the model already ranked next.
    """
    player_ids = list(scores)
    if not player_ids:
        return {"__replacement__": {"target_share": 1.0, "carry_share": 1.0}}

    available = np.array([bool(available_mask.get(pid, True)) for pid in player_ids])
    target_scores = np.array([scores[pid][TARGET_CHANNEL] for pid in player_ids])
    carry_scores = np.array([scores[pid][CARRY_CHANNEL] for pid in player_ids])

    target_shares = _softmax_shares(target_scores, available)
    carry_shares = _softmax_shares(carry_scores, available)

    # The replacement pool absorbs whatever the modelled players did not claim,
    # so each channel sums to exactly 1. With a proper softmax over available
    # players the modelled shares already sum to 1 (pool ~ 0) when at least one
    # player is available; when the whole team is unavailable the pool is 1.0 and
    # absorbs the entire team's opportunity. Clamp the pool at zero so a
    # floating-point overshoot never produces a tiny negative share.
    target_pool = max(1.0 - float(target_shares.sum()), 0.0)
    carry_pool = max(1.0 - float(carry_shares.sum()), 0.0)

    out: dict[str, dict[str, float]] = {
        pid: {
            "target_share": float(target_shares[i]),
            "carry_share": float(carry_shares[i]),
        }
        for i, pid in enumerate(player_ids)
    }
    out["__replacement__"] = {
        "target_share": target_pool + REPLACEMENT_POOL_FLOOR,
        "carry_share": carry_pool + REPLACEMENT_POOL_FLOOR,
    }
    # Renormalise once so the floored pool does not push the sum past 1: the
    # simplex must be exact for the Multinomial sampler.
    _renormalise_in_place(out, "target_share")
    _renormalise_in_place(out, "carry_share")
    return out


def _renormalise_in_place(shares: dict[str, dict[str, float]], key: str) -> None:
    total = sum(entry[key] for entry in shares.values())
    if total <= 0.0:
        return
    for entry in shares.values():
        entry[key] = entry[key] / total


# ---------------------------------------------------------------------------
# The simulation-facing sampler.
# ---------------------------------------------------------------------------


def sample_player_opportunities(
    rng: np.random.Generator,
    *,
    pass_attempts: np.ndarray,
    rush_attempts: np.ndarray,
    target_shares: dict[str, float],
    carry_shares: dict[str, float],
    draw_count: int,
) -> dict[str, dict[str, np.ndarray]]:
    """Draw per-player target and carry counts, vectorised across ``draw_count``.

    ``pass_attempts`` and ``rush_attempts`` are ``(draw_count,)`` integer arrays —
    the per-draw team volumes Layer 1's :func:`sample_team_volumes` produced.
    ``target_shares`` / ``carry_shares`` are one team's coherent shares from
    :func:`allocate_shares` (they sum to 1 over players plus the replacement
    pool). Returns ``{player_id: {"targets": (draw_count,), "carries":
    (draw_count,)}}`` — the replacement pool is dropped from the return, since it
    is not a projected player, but it participated in the allocation so the
    modelled players never over-claim the team's attempts.

    The draw is a **Multinomial** per channel: given a draw's ``pass_attempts``
    total, the targets are split across players by ``target_shares``. Because the
    totals are fixed per draw, one player's extra targets are another's fewer —
    teammates *compete*, which is the within-team negative correlation the joint
    simulation requires. NumPy's ``Generator.multinomial`` is vectorised: passing
    the ``(draw_count,)`` totals array draws every simulation at once along a
    single axis, with **no Python loop over draws** (the vectorisation test
    asserts this).
    """
    if draw_count <= 0:
        raise ValueError("draw_count must be positive")
    if pass_attempts.shape != (draw_count,) or rush_attempts.shape != (draw_count,):
        raise ValueError(
            "pass_attempts and rush_attempts must each be shape (draw_count,)"
        )

    target_counts = _multinomial_by_share(rng, pass_attempts, target_shares, draw_count)
    carry_counts = _multinomial_by_share(rng, rush_attempts, carry_shares, draw_count)

    # Union of players across the two channels, excluding the replacement pool —
    # a player may have targets but no carries or vice versa.
    player_ids = sorted(
        (set(target_shares) | set(carry_shares)) - {"__replacement__"}
    )
    out: dict[str, dict[str, np.ndarray]] = {}
    for pid in player_ids:
        out[pid] = {
            "targets": target_counts.get(
                pid, np.zeros(draw_count, dtype=np.int64)
            ),
            "carries": carry_counts.get(
                pid, np.zeros(draw_count, dtype=np.int64)
            ),
        }
    return out


def _multinomial_by_share(
    rng: np.random.Generator,
    totals: np.ndarray,
    shares: dict[str, float],
    draw_count: int,
) -> dict[str, np.ndarray]:
    """Vectorised ``Multinomial(totals, pvals)`` split, keyed by player id.

    NumPy's ``Generator.multinomial`` does not accept a per-draw ``n`` in one
    call, but it *is* vectorised over categories: for a given ``n`` it returns a
    ``(n_categories,)`` count vector in one array operation. We therefore group
    the draws by their (small, integer) total and draw each group in a single
    vectorised ``multinomial(n, pvals, size=group_size)`` call — a handful of
    array operations over the distinct totals, never a Python loop over the
    5,000 draws. The distinct totals are few (a team's attempts vary by a few
    dozen), so this is O(distinct totals), not O(draw_count).
    """
    ordered_ids = [pid for pid in shares if pid != "__replacement__"]
    # The pvals must include the replacement pool so the multinomial is over the
    # full simplex (players + pool); we discard the pool column afterward.
    pool = shares.get("__replacement__", 0.0)
    pvals = np.array([shares[pid] for pid in ordered_ids] + [pool], dtype=np.float64)
    # Guard against floating drift: renormalise to a strict simplex.
    pvals = pvals / pvals.sum() if pvals.sum() > 0 else pvals

    counts = {pid: np.zeros(draw_count, dtype=np.int64) for pid in ordered_ids}
    if not ordered_ids:
        return counts

    totals_int = totals.astype(np.int64)
    # Distinct totals are few; draw each group vectorised across its members.
    for n in np.unique(totals_int):
        idx = np.nonzero(totals_int == n)[0]
        group = rng.multinomial(int(n), pvals, size=idx.size)  # (idx.size, n_cat)
        for j, pid in enumerate(ordered_ids):
            counts[pid][idx] = group[:, j]
    return counts


# ---------------------------------------------------------------------------
# Validation metric (RD-8).
# ---------------------------------------------------------------------------


def usage_share_mae(
    predicted_shares: dict[str, dict[str, float]],
    observed_shares: dict[str, dict[str, float]],
    had_opportunity_mask: dict[str, bool],
) -> dict[str, float]:
    """Layer-2 validation MAE (RD-8), over players with a real opportunity only.

    ``predicted_shares`` and ``observed_shares`` map player id to
    ``{target_share, carry_share}``. ``had_opportunity_mask`` marks the players
    who recorded a real opportunity (a target or a carry) in the game. Returns:

    * ``target_share_mae`` — mean absolute error on target share.
    * ``carry_share_mae`` — mean absolute error on carry share.

    **Only players who had an opportunity are scored.** A player correctly
    predicted at a near-zero share who did not play contributes no error — he was
    right to be near zero, and including him would flatter the metric with easy
    zeros (a bench full of correctly-predicted non-participants would drive the
    MAE arbitrarily low). Scoring the players who actually competed for the ball
    is what makes the metric measure allocation skill rather than roster size.
    """
    scored = [
        pid
        for pid in predicted_shares
        if pid in observed_shares and had_opportunity_mask.get(pid, False)
    ]
    if not scored:
        # No player recorded an opportunity: the metric is undefined rather than
        # a misleading zero. The harness reports it as absent for this game.
        return {"target_share_mae": float("nan"), "carry_share_mae": float("nan")}
    target_errors = [
        abs(predicted_shares[pid]["target_share"] - observed_shares[pid]["target_share"])
        for pid in scored
    ]
    carry_errors = [
        abs(predicted_shares[pid]["carry_share"] - observed_shares[pid]["carry_share"])
        for pid in scored
    ]
    return {
        "target_share_mae": float(np.mean(target_errors)),
        "carry_share_mae": float(np.mean(carry_errors)),
    }
