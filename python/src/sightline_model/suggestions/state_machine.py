"""The dedup / reversal / conflict / post-kickoff state machine (decision 3, 4).

A pure function over the current confirmed claim and a newly-observed one on the
same ``(source, subject_player, claim_type)`` identity. No database, no clock of
its own — the caller supplies ``now`` and the current active event — so the whole
of the pitch's "three outcomes from one comparison rule" is unit-testable
without a Postgres round-trip.

The four outcomes:

* **duplicate** — same value as the current active claim. Nothing new is raised;
  the caller only bumps ``last_confirmed_at``.
* **reversal / update** — a different value, and the prior claim is *stable*
  (older than the conflict window with no contradiction). The prior is
  superseded and retained; the new claim is evaluated fresh for materiality.
* **conflict** — a different value while the prior claim is still *unstable*
  (within the conflict window). Neither is treated as current; the claim enters
  an explicit conflicting state naming both, favouring visible uncertainty over
  picking whichever arrived last.
* **post_kickoff** — the observation arrived at/after actual kickoff. It is
  retained for source-reliability grading but can never edit the frozen pre-game
  record, and no shadow is computed. This boundary is the KICKOFF timestamp, and
  is deliberately distinct from the staking pitch's 10-minute trading cutoff
  (decision 4).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class Action(str, Enum):
    """What the caller should do with a newly-observed claim."""

    create_new = "create_new"  # first claim on this identity, or a reversal
    duplicate = "duplicate"  # same value; only bump last_confirmed_at
    conflict = "conflict"  # contradictory within the window; neither is current
    post_kickoff = "post_kickoff"  # after kickoff; retained, non-actionable


@dataclass(frozen=True)
class CurrentClaim:
    """The current live (non-superseded) claim on an identity, or absent."""

    claim_value: str
    raised_at: datetime
    status: str  # SourceEventStatus: active | conflicting | post_kickoff


@dataclass(frozen=True)
class Decision:
    """The state machine's verdict for one observation."""

    action: Action
    # Whether the current active claim must be marked superseded (a reversal).
    supersede_current: bool
    # Whether the caller should compute a shadow + evaluate materiality. Only a
    # genuinely new, pre-kickoff, non-conflicting claim is actionable.
    actionable: bool


def classify(
    *,
    current: CurrentClaim | None,
    observed_value: str,
    observed_at: datetime,
    now: datetime,
    kickoff_at: datetime,
    conflict_window_minutes: float,
) -> Decision:
    """Classify a newly-observed claim against the current confirmed one.

    ``observed_at`` is the source's publication/observation time (the event's
    ``known_at``); ``now`` is the moment the observation is being processed, used
    only to decide whether the prior claim has become stable. Post-kickoff is
    judged on ``observed_at`` against ``kickoff_at`` — an observation that
    *arrived* after kickoff cannot rewrite pre-game state regardless of when it is
    processed.
    """
    if observed_at >= kickoff_at:
        # Frozen pre-game record: retained for source grading, never actionable.
        return Decision(
            action=Action.post_kickoff, supersede_current=False, actionable=False
        )

    if current is None:
        return Decision(
            action=Action.create_new, supersede_current=False, actionable=True
        )

    if current.claim_value == observed_value:
        # Repeated confirmation of the same information — no new suggestion.
        return Decision(
            action=Action.duplicate, supersede_current=False, actionable=False
        )

    # A different value. Whether it is a reversal or a conflict turns on whether
    # the prior claim has had time to stabilise.
    elapsed_minutes = (now - current.raised_at).total_seconds() / 60.0
    if elapsed_minutes > conflict_window_minutes:
        # The prior claim was stable; this is a genuine reversal/update.
        return Decision(
            action=Action.create_new, supersede_current=True, actionable=True
        )

    # Two contradictory values inside the window before either stabilised.
    return Decision(
        action=Action.conflict, supersede_current=False, actionable=False
    )
