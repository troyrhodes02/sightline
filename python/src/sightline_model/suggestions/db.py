"""Database reads and writes for the Adjustment Suggestions engine.

The engine writes source events, shadow projections, and suggestions; it reads
the current claim, the game's listed contracts (identity + threshold only —
NEVER a price), and the freshest base projections it compares against. All
writes run inside the caller's transaction so a partial suggestion is
impossible.

Reading ``contracts.threshold`` is sanctioned: it is market metadata about the
listed line, not a price. The import-graph guard bars the price and
recommendation-snapshot tables; this module touches neither (and the guard's
substring sweep is why this sentence avoids naming them literally).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from ..constants import MODEL_VERSION

_NS = uuid.UUID("b9d0e1a2-3c4d-5e6f-7a8b-9c0d1e2f3a4b")


def source_event_id(
    source: str, subject_player_id: str, claim_type: str, known_at: datetime
) -> str:
    key = (
        f"sightline:source_event:{source}:{subject_player_id}:{claim_type}:"
        f"{known_at.isoformat()}"
    )
    return str(uuid.uuid5(_NS, key))


def suggestion_id(source_event_id_: str, target_player_id: str, stat_type: str) -> str:
    key = f"sightline:suggestion:{source_event_id_}:{target_player_id}:{stat_type}"
    return str(uuid.uuid5(_NS, key))


def shadow_projection_id(
    source_event_id_: str, target_player_id: str, stat_type: str
) -> str:
    key = f"sightline:shadow:{source_event_id_}:{target_player_id}:{stat_type}"
    return str(uuid.uuid5(_NS, key))


def _rows(cur) -> list[dict[str, Any]]:
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


# --- source events ---------------------------------------------------------


def get_live_source_event(
    cur, *, source: str, subject_player_id: str, claim_type: str
) -> dict[str, Any] | None:
    """The current non-superseded event on this dedup identity, if any."""
    cur.execute(
        'select id, claim_value, status, raised_at, evidence_text '
        'from adjustment_source_events '
        'where source = %s::"DataSource" and subject_player_id = %s '
        "and claim_type = %s and status <> 'superseded' "
        "order by raised_at desc limit 1",
        (source, subject_player_id, claim_type),
    )
    found = _rows(cur)
    return found[0] if found else None


def insert_source_event(
    cur,
    *,
    event_id: str,
    source: str,
    subject_player_id: str,
    game_id: str,
    claim_type: str,
    claim_value: str,
    evidence_text: str,
    status: str,
    valid_at: datetime,
    known_at: datetime,
    raised_at: datetime,
    last_confirmed_at: datetime,
    ingest_run_id: str,
) -> None:
    cur.execute(
        "insert into adjustment_source_events ("
        "  id, source, subject_player_id, game_id, claim_type, claim_value,"
        "  evidence_text, status, valid_at, known_at, known_at_reconstructed,"
        "  raised_at, last_confirmed_at, ingest_run_id, updated_at"
        ") values ("
        '  %s, %s::"DataSource", %s, %s, %s, %s, %s, %s::"SourceEventStatus",'
        "  %s, %s, false, %s, %s, %s, now()"
        ") on conflict (id) do nothing",
        (
            event_id, source, subject_player_id, game_id, claim_type, claim_value,
            evidence_text, status, valid_at, known_at, raised_at,
            last_confirmed_at, ingest_run_id,
        ),
    )


def bump_last_confirmed(cur, *, event_id: str, at: datetime) -> None:
    cur.execute(
        "update adjustment_source_events set last_confirmed_at = %s, updated_at = now() "
        "where id = %s",
        (at, event_id),
    )


def mark_conflicting(cur, *, event_id: str, evidence_text: str) -> None:
    cur.execute(
        "update adjustment_source_events "
        "set status = 'conflicting'::\"SourceEventStatus\", evidence_text = %s, "
        "updated_at = now() where id = %s",
        (evidence_text, event_id),
    )


def supersede_event(cur, *, old_event_id: str, new_event_id: str) -> None:
    cur.execute(
        "update adjustment_source_events "
        "set status = 'superseded'::\"SourceEventStatus\", superseded_by_id = %s, "
        "updated_at = now() where id = %s",
        (new_event_id, old_event_id),
    )


# --- contracts (threshold only) + base projections -------------------------


def listed_contracts_for_game(cur, *, game_id: str) -> list[dict[str, Any]]:
    """Resolved, active contracts for a game: player, stat, threshold. No price."""
    cur.execute(
        "select player_id, stat_type::text as stat_type, threshold "
        "from contracts "
        "where game_id = %s and player_id is not null and stat_type is not null "
        "and resolution_status in ('resolved'::\"IdentityResolutionStatus\","
        " 'manual_override'::\"IdentityResolutionStatus\") "
        "and status = 'active'::\"ContractStatus\"",
        (game_id,),
    )
    return _rows(cur)


def freshest_base_projection(
    cur, *, player_id: str, game_id: str, stat_type: str
) -> dict[str, Any] | None:
    """The freshest base projection of the ACTIVE model for a (player, game, stat).

    Parallel model evaluation (SIG-103) stores BOTH engines' base projections
    for every eligible game/stat, so a suggestion must adjust the projection the
    slate actually shows — the one whose ``model_version`` matches the active
    ``ModelSelection`` for the stat — not whichever base row happens to sort
    first. Without this filter the read could return the shadow engine's base
    projection, whose compact distribution form differs from the active one, and
    the materiality comparison would be against a projection the user never sees.

    A stat with no ``ModelSelection`` row defaults to the baseline (the migration
    seeds every stat on the baseline), matching the live pipeline's own
    active-model convention.
    """
    cur.execute(
        "select p.id, p.distribution_kind, p.quantiles, p.pmf, p.projected_value, "
        "p.projected_median, p.interval_low, p.interval_high, p.confidence, "
        "p.model_version "
        "from projections p "
        "left join model_selections ms on ms.stat_type = p.stat_type "
        "where p.player_id = %s and p.game_id = %s and p.stat_type = %s::\"StatType\" "
        "and p.provenance = 'base'::\"ProjectionProvenance\" "
        "and p.model_version = coalesce(ms.model_version, %s) "
        "order by p.information_cutoff desc, p.computed_at desc limit 1",
        (player_id, game_id, stat_type, MODEL_VERSION),
    )
    found = _rows(cur)
    return found[0] if found else None


# --- shadow projection + suggestion writes ---------------------------------

_INSERT_SHADOW_SQL = """
    insert into projections (
        id, player_id, game_id, stat_type, model_version, distribution_kind,
        params, quantiles, pmf, projected_value, projected_median,
        interval_low, interval_high, confidence, n_eff,
        computed_at, information_cutoff, provenance, adjustment_suggestion_id
    ) values (
        %(id)s, %(player_id)s, %(game_id)s, %(stat_type)s::"StatType",
        %(model_version)s, %(distribution_kind)s, %(params)s, %(quantiles)s,
        %(pmf)s, %(projected_value)s, %(projected_median)s, %(interval_low)s,
        %(interval_high)s, %(confidence)s::"Confidence", %(n_eff)s,
        %(computed_at)s, %(information_cutoff)s,
        'adjustment_shadow'::"ProjectionProvenance", %(adjustment_suggestion_id)s
    )
    on conflict (player_id, game_id, stat_type, model_version, information_cutoff, provenance)
    do nothing
"""

_INSERT_DRIVER_SQL = """
    insert into projection_drivers (id, projection_id, rank, text)
    values (%(id)s, %(projection_id)s, %(rank)s, %(text)s)
    on conflict (projection_id, rank) do nothing
"""

_INSERT_SUGGESTION_SQL = """
    insert into adjustment_suggestions (
        id, source_event_id, target_player_id, game_id, stat_type,
        base_projection_id, shadow_projection_id, status, materiality_kind,
        material_threshold_pp, material_relative_pct, reason_text, updated_at
    ) values (
        %(id)s, %(source_event_id)s, %(target_player_id)s, %(game_id)s,
        %(stat_type)s::"StatType", %(base_projection_id)s, %(shadow_projection_id)s,
        %(status)s::"SuggestionStatus", %(materiality_kind)s,
        %(material_threshold_pp)s, %(material_relative_pct)s, %(reason_text)s, now()
    ) on conflict (id) do nothing
"""


def insert_shadow_projection(cur, *, row: dict[str, Any], drivers: list[str]) -> None:
    payload = dict(row)
    payload["params"] = json.dumps(row.get("params") or {})
    payload["quantiles"] = (
        json.dumps(row["quantiles"]) if row.get("quantiles") is not None else None
    )
    payload["pmf"] = json.dumps(row["pmf"]) if row.get("pmf") is not None else None
    cur.execute(_INSERT_SHADOW_SQL, payload)
    for rank, text in enumerate(drivers):
        cur.execute(
            _INSERT_DRIVER_SQL,
            {
                "id": str(uuid.uuid5(_NS, f"driver:{row['id']}:{rank}")),
                "projection_id": row["id"],
                "rank": rank,
                "text": text,
            },
        )


def insert_suggestion(cur, *, row: dict[str, Any]) -> None:
    cur.execute(_INSERT_SUGGESTION_SQL, row)


def player_names(cur, *, player_ids: list[str]) -> dict[str, str]:
    """Display names for reason-text generation. Empty result for unknown ids."""
    if not player_ids:
        return {}
    cur.execute(
        "select id, full_name from players where id = any(%s)",
        (list(player_ids),),
    )
    return {r["id"]: r["full_name"] for r in _rows(cur)}
