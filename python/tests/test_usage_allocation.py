"""Layer 2 (usage allocation) unit tests — no database required.

Covers the scorer's fit/predict on a small synthetic frame, coherent within-team
allocation (shares sum to 1, absence redistributes structurally, the team never
over-allocates), the vectorised Multinomial sampler (shape, reproducibility, and
the within-team NEGATIVE correlation that competing shares produce), and the
RD-8 usage-share MAE computed only over players who had a real opportunity. The
as-of-only feature-assembly guarantee is exercised adversarially (with a
database) in ``test_asof_leakage.py``; here we assert the narrower structural
fact that feature assembly reads nothing but the corpus.
"""

from __future__ import annotations

import inspect

import numpy as np
import polars as pl
import pytest

from sightline_model.simulation import usage_allocation as ua
from sightline_model.simulation.usage_allocation import (
    CARRY_CHANNEL,
    FEATURE_COLUMNS,
    LABEL_COLUMNS,
    TARGET_CHANNEL,
    PlayerUsageFeatures,
    UsageAllocationModel,
    allocate_shares,
    assemble_usage_features,
    sample_player_opportunities,
    usage_share_mae,
)


# --- Feature assembly reads only the corpus ---------------------------------


def test_assemble_features_takes_only_a_corpus() -> None:
    # The corpus-plus-identity signature is the structural guarantee: the
    # function cannot open its own connection, so it inherits the cutoff. It
    # accepts an AsOfCorpus and game/team identity, never a DSN or a raw frame,
    # and never a "current roster" reader.
    sig = inspect.signature(assemble_usage_features)
    params = list(sig.parameters)
    assert params[0] == "corpus"
    assert not any(
        p in ("connect", "conn", "dsn", "frame", "df", "roster", "current_team")
        for p in params
    )


def test_no_current_roster_accessor_in_module() -> None:
    # History follows the player: team membership is read from each trailing
    # row's team_abbr_at_game, never a current-roster join. Assert the module
    # exposes no accessor by which a current team/roster could leak in.
    names = dir(ua)
    for forbidden in ("current_team", "current_roster", "roster_today", "active_roster"):
        assert forbidden not in names


# --- Model fits and predicts on a small synthetic frame ---------------------


def _synthetic_usage_frame(n: int = 200) -> pl.DataFrame:
    """A small synthetic player-game usage frame with a learnable signal.

    A player's observed target share rises with his trailing target share; carry
    share rises with trailing carry share. A fittable frame, not a realistic one.
    """
    rng = np.random.default_rng(11)
    tgt = rng.uniform(0.0, 0.35, n)
    car = rng.uniform(0.0, 0.30, n)
    snap = rng.uniform(0.0, 1.2, n)
    pos = rng.choice(list(ua._POSITION_CODES.values()), n)
    avail = rng.choice([0.0, 1.0], n, p=[0.1, 0.9])
    return pl.DataFrame(
        {
            "trailing_target_share": tgt,
            "trailing_carry_share": car,
            "trailing_snap_proxy": snap,
            "position_code": pos,
            "is_available": avail,
            "observed_target_share": tgt + rng.normal(0, 0.02, n),
            "observed_carry_share": car + rng.normal(0, 0.02, n),
        }
    )


def _features(available: dict[str, bool] | None = None) -> dict[str, PlayerUsageFeatures]:
    available = available or {}
    specs = {
        # A pass-catching back, two receivers, a tight end — a plausible skill room.
        "rb1": ("RB", 0.18, 0.55, 1.0),
        "wr1": ("WR", 0.30, 0.0, 1.0),
        "wr2": ("WR", 0.20, 0.0, 0.8),
        "te1": ("TE", 0.12, 0.0, 0.6),
    }
    out: dict[str, PlayerUsageFeatures] = {}
    for pid, (pos, tgt, car, snap) in specs.items():
        out[pid] = PlayerUsageFeatures(
            player_id=pid,
            team_abbr="KC",
            position=pos,
            is_available=available.get(pid, True),
            trailing_target_share=tgt,
            trailing_carry_share=car,
            trailing_snap_proxy=snap,
        )
    return out


def test_label_columns_are_the_two_observed_shares() -> None:
    assert LABEL_COLUMNS == ("observed_target_share", "observed_carry_share")


def test_model_fits_and_predicts_nonnegative_scores() -> None:
    model = UsageAllocationModel().fit(_synthetic_usage_frame())
    scores = model.predict(_features())
    assert set(scores) == {"rb1", "wr1", "wr2", "te1"}
    for s in scores.values():
        assert s[TARGET_CHANNEL] >= 0.0
        assert s[CARRY_CHANNEL] >= 0.0
    # The heavy-target receiver should out-score the tight end on the target
    # channel; the back should out-score everyone on carries.
    assert scores["wr1"][TARGET_CHANNEL] > scores["te1"][TARGET_CHANNEL]
    assert scores["rb1"][CARRY_CHANNEL] > scores["wr1"][CARRY_CHANNEL]


def test_model_persists_and_reloads(tmp_path) -> None:
    model = UsageAllocationModel().fit(_synthetic_usage_frame())
    path = tmp_path / "usage.joblib"
    model.save(path)
    reloaded = UsageAllocationModel.load(path)
    a = model.predict(_features())
    b = reloaded.predict(_features())
    for pid in a:
        assert a[pid][TARGET_CHANNEL] == b[pid][TARGET_CHANNEL]
        assert a[pid][CARRY_CHANNEL] == b[pid][CARRY_CHANNEL]


def test_predict_before_fit_raises() -> None:
    with pytest.raises(RuntimeError):
        UsageAllocationModel().predict(_features())


# --- Coherent within-team allocation ----------------------------------------


def _scores() -> dict[str, dict[str, float]]:
    return {
        "rb1": {TARGET_CHANNEL: 1.0, CARRY_CHANNEL: 3.0},
        "wr1": {TARGET_CHANNEL: 2.5, CARRY_CHANNEL: 0.0},
        "wr2": {TARGET_CHANNEL: 1.5, CARRY_CHANNEL: 0.0},
        "te1": {TARGET_CHANNEL: 0.8, CARRY_CHANNEL: 0.0},
    }


def test_shares_sum_to_one_over_the_team() -> None:
    shares = allocate_shares(_scores(), {pid: True for pid in _scores()})
    target_total = sum(s["target_share"] for s in shares.values())
    carry_total = sum(s["carry_share"] for s in shares.values())
    assert target_total == pytest.approx(1.0)
    assert carry_total == pytest.approx(1.0)
    # A replacement/other pool is present so the simplex is over players + pool.
    assert "__replacement__" in shares


def test_total_allocated_opportunity_never_exceeds_team() -> None:
    # The team share simplex, multiplied by any team attempt total, must sum to
    # exactly that total — the team never allocates more opportunity than it has.
    shares = allocate_shares(_scores(), {pid: True for pid in _scores()})
    pass_attempts = 40
    allocated = sum(s["target_share"] * pass_attempts for s in shares.values())
    assert allocated == pytest.approx(pass_attempts)


def test_marking_a_player_unavailable_zeroes_and_redistributes() -> None:
    # Removing wr1 (the top target earner) must drive HIS share to exactly zero
    # and RENORMALISE the freed mass across his available teammates — structural
    # redistribution, not a hand-authored override. His teammates' shares must
    # rise, and the team simplex must still sum to 1.
    all_available = allocate_shares(_scores(), {pid: True for pid in _scores()})
    without_wr1 = allocate_shares(
        _scores(),
        {"rb1": True, "wr1": False, "wr2": True, "te1": True},
    )
    assert without_wr1["wr1"]["target_share"] == 0.0
    # Freed target mass flows to teammates the model already ranked next.
    assert without_wr1["wr2"]["target_share"] > all_available["wr2"]["target_share"]
    assert without_wr1["te1"]["target_share"] > all_available["te1"]["target_share"]
    assert without_wr1["rb1"]["target_share"] > all_available["rb1"]["target_share"]
    # Still a coherent simplex.
    assert sum(s["target_share"] for s in without_wr1.values()) == pytest.approx(1.0)


def test_all_unavailable_team_allocates_to_replacement_pool() -> None:
    # If nobody can play, the whole team's opportunity flows to the replacement
    # pool rather than being fabricated onto an absent player.
    shares = allocate_shares(_scores(), {pid: False for pid in _scores()})
    for pid in _scores():
        assert shares[pid]["target_share"] == 0.0
        assert shares[pid]["carry_share"] == 0.0
    assert shares["__replacement__"]["target_share"] == pytest.approx(1.0)
    assert shares["__replacement__"]["carry_share"] == pytest.approx(1.0)


# --- Sampler: vectorised, reproducible, competing (negative corr) ------------


def _team_shares() -> tuple[dict[str, float], dict[str, float]]:
    shares = allocate_shares(_scores(), {pid: True for pid in _scores()})
    target = {pid: s["target_share"] for pid, s in shares.items()}
    carry = {pid: s["carry_share"] for pid, s in shares.items()}
    return target, carry


def _volumes(rng: np.random.Generator, draw_count: int) -> tuple[np.ndarray, np.ndarray]:
    # Per-draw team attempts, as Layer 1's sample_team_volumes would supply.
    pass_att = rng.integers(30, 45, size=draw_count)
    rush_att = rng.integers(20, 32, size=draw_count)
    return pass_att, rush_att


def test_sampler_is_vectorized_shape() -> None:
    rng = np.random.default_rng(123)
    target, carry = _team_shares()
    pass_att, rush_att = _volumes(rng, 5000)
    drawn = sample_player_opportunities(
        rng,
        pass_attempts=pass_att,
        rush_attempts=rush_att,
        target_shares=target,
        carry_shares=carry,
        draw_count=5000,
    )
    # The replacement pool is not a projected player and is dropped.
    assert set(drawn) == {"rb1", "wr1", "wr2", "te1"}
    for counts in drawn.values():
        # A single NumPy draw axis of length draw_count, per channel.
        assert counts["targets"].shape == (5000,)
        assert counts["carries"].shape == (5000,)
        assert np.issubdtype(counts["targets"].dtype, np.integer)


def test_sampler_contains_no_python_loop_over_draws() -> None:
    # RD structural check: the sampler must not iterate per draw. It may loop
    # over players and over the (few) distinct attempt totals, but never over
    # range(draw_count) or per-draw.
    source = inspect.getsource(sample_player_opportunities) + inspect.getsource(
        ua._multinomial_by_share
    )
    assert "range(draw_count)" not in source
    assert "for _ in range" not in source


def test_sampler_is_reproducible_given_a_seeded_rng() -> None:
    target, carry = _team_shares()
    pass_att, rush_att = _volumes(np.random.default_rng(7), 3000)
    a = sample_player_opportunities(
        np.random.default_rng(42),
        pass_attempts=pass_att,
        rush_attempts=rush_att,
        target_shares=target,
        carry_shares=carry,
        draw_count=3000,
    )
    b = sample_player_opportunities(
        np.random.default_rng(42),
        pass_attempts=pass_att,
        rush_attempts=rush_att,
        target_shares=target,
        carry_shares=carry,
        draw_count=3000,
    )
    for pid in a:
        assert np.array_equal(a[pid]["targets"], b[pid]["targets"])
        assert np.array_equal(a[pid]["carries"], b[pid]["carries"])


def test_teammates_targets_are_negatively_correlated() -> None:
    # Multinomial draws over a fixed per-draw total make teammates COMPETE: one
    # receiver's extra targets are another's fewer. Hold the team's pass total
    # constant across draws so the only variation is the split, isolating the
    # competition — the correlation between two receivers' target counts must be
    # negative.
    rng = np.random.default_rng(2024)
    target, carry = _team_shares()
    draw_count = 20000
    pass_att = np.full(draw_count, 38, dtype=np.int64)
    rush_att = np.full(draw_count, 26, dtype=np.int64)
    drawn = sample_player_opportunities(
        rng,
        pass_attempts=pass_att,
        rush_attempts=rush_att,
        target_shares=target,
        carry_shares=carry,
        draw_count=draw_count,
    )
    corr = float(np.corrcoef(drawn["wr1"]["targets"], drawn["wr2"]["targets"])[0, 1])
    assert corr < 0.0, f"expected competing (negative) target correlation, got {corr}"


def test_totals_never_exceed_team_attempts_in_any_draw() -> None:
    # In every simulated draw, the modelled players' allocated targets can never
    # exceed the team's pass attempts for that draw (the replacement pool absorbs
    # the rest). Coherence holds draw-by-draw, not just in expectation.
    rng = np.random.default_rng(99)
    target, carry = _team_shares()
    draw_count = 4000
    pass_att, rush_att = _volumes(rng, draw_count)
    drawn = sample_player_opportunities(
        rng,
        pass_attempts=pass_att,
        rush_attempts=rush_att,
        target_shares=target,
        carry_shares=carry,
        draw_count=draw_count,
    )
    total_targets = sum(c["targets"] for c in drawn.values())
    total_carries = sum(c["carries"] for c in drawn.values())
    assert np.all(total_targets <= pass_att)
    assert np.all(total_carries <= rush_att)


# --- Validation metric (RD-8) -----------------------------------------------


def test_usage_share_mae_scores_only_players_with_opportunity() -> None:
    predicted = {
        "wr1": {"target_share": 0.30, "carry_share": 0.0},
        "wr2": {"target_share": 0.20, "carry_share": 0.0},
        # A deep bench player correctly predicted near zero who did NOT play.
        "wr5": {"target_share": 0.01, "carry_share": 0.0},
    }
    observed = {
        "wr1": {"target_share": 0.34, "carry_share": 0.0},
        "wr2": {"target_share": 0.16, "carry_share": 0.0},
        "wr5": {"target_share": 0.0, "carry_share": 0.0},
    }
    # wr5 recorded no opportunity: he is excluded from the error even though his
    # near-zero prediction was correct — including easy zeros would flatter it.
    mask = {"wr1": True, "wr2": True, "wr5": False}
    result = usage_share_mae(predicted, observed, mask)
    # target errors over {wr1, wr2}: |0.30-0.34|=0.04, |0.20-0.16|=0.04 -> 0.04
    assert result["target_share_mae"] == pytest.approx(0.04)
    assert result["carry_share_mae"] == pytest.approx(0.0)


def test_usage_share_mae_including_the_bench_would_differ() -> None:
    # Prove the exclusion actually changes the number: if wr5 were scored, his
    # zero-error would drag the mean down. The metric must NOT do this.
    predicted = {
        "wr1": {"target_share": 0.30, "carry_share": 0.0},
        "wr5": {"target_share": 0.01, "carry_share": 0.0},
    }
    observed = {
        "wr1": {"target_share": 0.34, "carry_share": 0.0},
        "wr5": {"target_share": 0.0, "carry_share": 0.0},
    }
    scored_only_participant = usage_share_mae(
        predicted, observed, {"wr1": True, "wr5": False}
    )
    scored_everyone = usage_share_mae(predicted, observed, {"wr1": True, "wr5": True})
    # wr1 alone: |0.30-0.34| = 0.04. Including wr5 (error 0.01) would give
    # mean(0.04, 0.01) = 0.025 — a different, flattered number.
    assert scored_only_participant["target_share_mae"] == pytest.approx(0.04)
    assert scored_everyone["target_share_mae"] == pytest.approx(0.025)
    assert scored_only_participant["target_share_mae"] != scored_everyone["target_share_mae"]


def test_usage_share_mae_no_participants_is_nan() -> None:
    predicted = {"wr1": {"target_share": 0.3, "carry_share": 0.0}}
    observed = {"wr1": {"target_share": 0.3, "carry_share": 0.0}}
    result = usage_share_mae(predicted, observed, {"wr1": False})
    assert np.isnan(result["target_share_mae"])
    assert np.isnan(result["carry_share_mae"])


def test_feature_columns_are_the_fixed_set() -> None:
    assert FEATURE_COLUMNS == (
        "trailing_target_share",
        "trailing_carry_share",
        "trailing_snap_proxy",
        "position_code",
        "is_available",
    )
