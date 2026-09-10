"""Resolved constants for Adjustment Suggestions & Source Reliability.

These mirror the TypeScript values in ``src/lib/suggestions/config.ts``; the two
runtimes share one Postgres database and must agree on what "material",
"conflicting", and "enough evidence to report a rate" mean. Change one, change
the other.

Two of these were NOT specified in the approved planning docs and are this run's
chosen defaults, flagged for explicit human review before merge (spec §16):
``CONFLICT_WINDOW_MINUTES`` and ``RELIABILITY_MIN_SAMPLE``.
"""

from __future__ import annotations

# --- Conflict window (decision 3) ------------------------------------------
# Two contradictory, still-unconfirmed claims on the same (source, subject,
# claim_type) identity arriving within this many minutes are treated as
# CONFLICTING (neither current) rather than as a reversal. A claim older than
# this with no contradiction is "stable"; a later differing value then
# supersedes it. RUN DEFAULT — flagged for human review.
CONFLICT_WINDOW_MINUTES = 5

# --- Reliability reporting floor (decision 9) ------------------------------
# The minimum verifiable observations before a numeric rate is shown. Applied
# INDEPENDENTLY to Source Accuracy and Adjustment Accuracy — their populations
# diverge. Below it, the count is shown and the rate withheld. RUN DEFAULT —
# flagged for human review.
RELIABILITY_MIN_SAMPLE = 15

# --- Materiality (decision 5) ----------------------------------------------
# A suggestion is raised only when the shadow-adjusted projection would move a
# LISTED contract's threshold-probability by at least this many percentage
# points...
MATERIALITY_THRESHOLD_PP = 3.0
# ...or, when the affected player has NO listed contract, when the projected
# value shifts by at least this percent RELATIVE to the base projection. Keeps
# a currently-untradeable but material redistribution visible without noise.
MATERIALITY_RELATIVE_PCT = 10.0
