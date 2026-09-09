"""Deterministic per-game seed derivation for the Simulation Engine.

Reproducibility is a property of the computation, not of luck. The seed for a
game simulation derives deterministically from ``(game_id, model_version,
information_cutoff)`` — never from wall-clock time or an OS entropy source — so
re-running an identical historical prediction against the same model version,
cutoff, and seed derivation reproduces a byte-identical stored distribution.

The seed is derived at the GAME level, not per player: the simulation is joint
per game, so the whole game is drawn from one seeded stream and each player's
marginal is a deterministic function of that one run. Seeding per player would
destroy the within-game correlation the Definition of Done requires. ``player_id``
is therefore part of a stored prediction's *identity*, not an independent seed
input. (Determinism R1/R2, RD-SIM-7)
"""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import blake2b

# 8 bytes -> a 64-bit UNSIGNED seed, comfortably inside NumPy's accepted range.
# Note this can exceed a signed Postgres BIGINT (top bit set), so the persistence
# layer masks it to the non-negative signed-BIGINT range before storing it on
# ``GameSimulation.seed`` (which carries a ``seed >= 0`` check). That stored value
# is provenance only — it is never read back to re-seed. Reproducibility derives
# the seed afresh from (game_id, model_version, information_cutoff), so the full
# 64-bit value here is what actually seeds the simulation.
_SEED_BYTES = 8


def derive_seed(
    game_id: str,
    model_version: str,
    information_cutoff: datetime,
) -> int:
    """Return the deterministic non-negative seed for one game simulation.

    A timezone-aware ``information_cutoff`` is first canonicalised to UTC so two
    equal instants produce the same seed regardless of the offset they were
    spelled with; a naive datetime is taken to already be UTC. The result is
    stable across processes and platforms because BLAKE2b is; nothing here reads
    the clock or an RNG.
    """
    if information_cutoff.tzinfo is not None:
        information_cutoff = information_cutoff.astimezone(timezone.utc)
    material = f"{game_id}|{model_version}|{information_cutoff.isoformat()}"
    digest = blake2b(material.encode("utf-8"), digest_size=_SEED_BYTES).digest()
    return int.from_bytes(digest, byteorder="big")
