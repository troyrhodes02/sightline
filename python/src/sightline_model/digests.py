"""Content digests — the reproducibility claim, made checkable.

A backtest is a pure function of (corpus state, configuration, model version,
code version). "Pure function" is a claim, and a claim nobody can check is a
claim nobody should believe, so every run stores digests of what it produced
and ``verify`` compares them.

Three rules keep the digests meaningful:

* **Quantised values only.** Rows are quantised before hashing (see
  ``artifacts``), so a difference below the quantum cannot flip a digest and a
  difference above it always does.
* **Wall-clock values are excluded.** ``computed_at``, ``started_at``,
  ``finished_at``, durations, paths and the run id are not content — including
  them would make every run differ from every other and turn the check into
  decoration.
* **Canonical ordering.** Rows are sorted by an explicit key before hashing, so
  the digest is invariant to chunking, batching, and any future parallelism.
"""

from __future__ import annotations

import hashlib
import json
from typing import Iterable, Sequence

# Excluded from every content digest. Wall-clock and location, not content.
NON_CONTENT_FIELDS = frozenset(
    {
        "computed_at",
        "started_at",
        "finished_at",
        "duration_seconds",
        "artifact_path",
        "run_id",
        "generated_at",
    }
)


def _canonical(value: object) -> str:
    if isinstance(value, float):
        # repr of a quantised float is stable across platforms; str() of a
        # float that has already been rounded through Decimal is exact.
        return repr(value)
    return str(value)


def digest_rows(rows: Sequence[dict], *, sort_keys: Sequence[str]) -> str:
    """BLAKE2b over rows in canonical order, excluding non-content fields."""
    hasher = hashlib.blake2b(digest_size=32)
    ordered = sorted(
        rows, key=lambda row: tuple(_canonical(row.get(k)) for k in sort_keys)
    )
    for row in ordered:
        for key in sorted(row):
            if key in NON_CONTENT_FIELDS:
                continue
            hasher.update(key.encode())
            hasher.update(b"\x1f")
            hasher.update(_canonical(row[key]).encode())
            hasher.update(b"\x1e")
        hasher.update(b"\x1d")
    return hasher.hexdigest()


def digest_mapping(mapping: dict) -> str:
    """BLAKE2b over a JSON object with sorted keys and no wall-clock fields."""
    pruned = _prune(mapping)
    return hashlib.blake2b(
        json.dumps(pruned, sort_keys=True, default=str).encode(), digest_size=32
    ).hexdigest()


def _prune(value: object) -> object:
    if isinstance(value, dict):
        return {
            k: _prune(v) for k, v in value.items() if k not in NON_CONTENT_FIELDS
        }
    if isinstance(value, list):
        return [_prune(v) for v in value]
    return value


def digest_strings(parts: Iterable[str]) -> str:
    hasher = hashlib.blake2b(digest_size=32)
    for part in parts:
        hasher.update(part.encode())
        hasher.update(b"\x1e")
    return hasher.hexdigest()


# Fact tables whose contents define "the corpus state a run read".
_CORPUS_TABLES = (
    "games",
    "game_schedule_revisions",
    "player_game_stats",
    "player_game_stat_corrections",
    "player_game_context",
    "game_weather",
    "players",
)


def corpus_digest(connect) -> str:
    """A digest over the corpus a run read.

    Deliberately coarse — row counts, the latest ``known_at``, and the latest
    ``updated_at`` per table. Its job is to make "the same stored corpus state"
    a checkable precondition, so that a repeat run over a CHANGED corpus is
    reported as a different experiment rather than as a reproducibility
    failure. Those are different findings and conflating them would train the
    operator to ignore the real one.

    What it detects is any change made **through the ingest path**: a new row
    moves the count, a correction moves ``known_at`` and ``updated_at``. What it
    does NOT detect is a value edited by hand in the database, which changes
    neither. That is the safe direction — a hand-edit shows up as a genuine
    digest mismatch rather than as false confidence — but it is worth knowing
    that this digest is a precondition check, not a checksum of the corpus.
    """
    parts: list[str] = []
    with connect() as conn, conn.cursor() as cur:
        for table in _CORPUS_TABLES:
            cur.execute(f"select count(*) from {table}")
            count = cur.fetchone()[0]
            stamps: list[str] = []
            cur.execute(
                "select column_name from information_schema.columns "
                "where table_name = %s and column_name in "
                "('known_at', 'correction_known_at', 'updated_at') "
                "order by column_name",
                (table,),
            )
            for (column,) in cur.fetchall():
                cur.execute(f"select max({column}) from {table}")
                stamps.append(f"{column}={cur.fetchone()[0]}")
            parts.append(f"{table}:{count}:{','.join(stamps)}")
    return digest_strings(parts)
