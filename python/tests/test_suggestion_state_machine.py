"""The dedup / reversal / conflict / post-kickoff state machine (SIG-75).

Pure, DB-free. This is the pitch-required proof that one comparison rule produces
the correct one of its outcomes for an identical repeat, a changed value, and two
conflicting values inside the window — plus the kickoff-boundary case.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sightline_model.suggestions.state_machine import (
    Action,
    CurrentClaim,
    classify,
)

_KICKOFF = datetime(2026, 11, 1, 18, 0)
_CONFLICT_WINDOW = 5.0


def _classify(current, observed_value, observed_at, now):
    return classify(
        current=current,
        observed_value=observed_value,
        observed_at=observed_at,
        now=now,
        kickoff_at=_KICKOFF,
        conflict_window_minutes=_CONFLICT_WINDOW,
    )


def test_first_claim_is_a_new_actionable_event() -> None:
    at = _KICKOFF - timedelta(hours=2)
    d = _classify(None, "out", at, at)
    assert d.action is Action.create_new
    assert d.actionable is True
    assert d.supersede_current is False


def test_identical_repeat_is_a_duplicate() -> None:
    raised = _KICKOFF - timedelta(hours=2)
    current = CurrentClaim(claim_value="out", raised_at=raised, status="active")
    later = raised + timedelta(minutes=30)
    d = _classify(current, "out", later, later)
    assert d.action is Action.duplicate
    assert d.actionable is False


def test_changed_value_on_a_stable_claim_is_a_reversal() -> None:
    raised = _KICKOFF - timedelta(hours=2)
    current = CurrentClaim(claim_value="out", raised_at=raised, status="active")
    # Well past the conflict window: the prior claim was stable, so this is a
    # genuine reversal — supersede the prior and evaluate the new one fresh.
    later = raised + timedelta(minutes=30)
    d = _classify(current, "active", later, later)
    assert d.action is Action.create_new
    assert d.supersede_current is True
    assert d.actionable is True


def test_two_conflicting_values_within_the_window_are_a_conflict() -> None:
    raised = _KICKOFF - timedelta(hours=2)
    current = CurrentClaim(claim_value="out", raised_at=raised, status="active")
    # Only three minutes later — inside the five-minute window, before the first
    # claim stabilised. Neither is treated as current.
    later = raised + timedelta(minutes=3)
    d = _classify(current, "active", later, later)
    assert d.action is Action.conflict
    assert d.actionable is False
    assert d.supersede_current is False


def test_observation_after_kickoff_is_post_kickoff_and_never_actionable() -> None:
    # The boundary is the KICKOFF timestamp, not the 10-minute trading cutoff.
    after = _KICKOFF + timedelta(minutes=1)
    d = _classify(None, "out", after, after + timedelta(minutes=1))
    assert d.action is Action.post_kickoff
    assert d.actionable is False


def test_a_claim_one_minute_before_kickoff_is_still_actionable() -> None:
    # Distinct from the staking pitch's 10-minute cutoff: a suggestion may still
    # be raised inside that window; only the trade is blocked (a different check).
    before = _KICKOFF - timedelta(minutes=1)
    d = _classify(None, "out", before, before)
    assert d.action is Action.create_new
    assert d.actionable is True
