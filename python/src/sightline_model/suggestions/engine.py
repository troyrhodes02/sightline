"""The Adjustment Suggestions engine (SIG-75).

Given a source observation (ESPN inactives is the first source, wired in SIG-76),
this runs the dedup / reversal / conflict / post-kickoff state machine, computes a
shadow-adjusted projection via the Simulation Engine with the subject forced
unavailable, evaluates materiality, and persists source events, shadow
projections, and per-projection suggestions — all inside the caller's transaction.

Point-in-time discipline is inherited whole: the shadow is computed through the
cutoff-bound ``AsOfCorpus`` at ``information_cutoff = observation.known_at``, the
same query layer the base path reads. No price is ever read (materiality uses
``Contract.threshold`` only). Nothing here makes a suggestion active — that is
William's explicit accept, downstream.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from sightline_ingest.asof import AsOfCorpus
from sightline_model.simulation import live
from sightline_model.simulation.config import SIMULATION_MODEL_VERSION
from sightline_model.suggestions import db
from sightline_model.suggestions.constants import (
    CONFLICT_WINDOW_MINUTES,
    MATERIALITY_RELATIVE_PCT,
    MATERIALITY_THRESHOLD_PP,
)
from sightline_model.suggestions.materiality import (
    KIND_UNLISTED_RELATIVE_PCT,
    ProjectionDist,
    evaluate_materiality,
)
from sightline_model.suggestions.state_machine import (
    Action,
    CurrentClaim,
    classify,
)

# Claim values that redistribute usage (the player is expected to sit).
_OUT_VALUES = frozenset({"out", "doubtful", "ir", "pup"})


@dataclass(frozen=True)
class Observation:
    """One raw source claim about one player, as ingested."""

    source: str  # DataSource, e.g. "espn"
    subject_player_id: str
    game_id: str
    claim_type: str  # "game_status"
    claim_value: str  # "out" | "doubtful" | "active" | ...
    evidence_text: str
    known_at: datetime  # source publication time
    ingest_run_id: str


@dataclass
class ObservationResult:
    """What the engine did with one observation (for the run summary + tests)."""

    action: str
    source_event_id: str | None = None
    suggestions_created: int = 0
    insufficient_evidence: int = 0
    shadows_persisted: int = 0
    target_stats: list[str] = field(default_factory=list)


def process_observation(
    conn,
    corpus_factory: Callable[[datetime], AsOfCorpus],
    *,
    observation: Observation,
    game: dict,
    models: live.SimulationModels,
    now: datetime,
    conflict_window_minutes: float = CONFLICT_WINDOW_MINUTES,
    threshold_pp: float = MATERIALITY_THRESHOLD_PP,
    relative_pct: float = MATERIALITY_RELATIVE_PCT,
    draw_count: int | None = None,
) -> ObservationResult:
    """Process one source observation end to end, inside a transaction.

    ``game`` must carry ``id``, ``season``, ``home_abbr``, ``away_abbr``,
    ``is_dome``, and ``kickoff_at``. ``corpus_factory(cutoff)`` returns an
    ``AsOfCorpus`` bound to that cutoff.
    """
    obs = observation
    kickoff_at = game["kickoff_at"]

    with conn.cursor() as cur:
        current_row = db.get_live_source_event(
            cur,
            source=obs.source,
            subject_player_id=obs.subject_player_id,
            claim_type=obs.claim_type,
        )
        current = (
            CurrentClaim(
                claim_value=current_row["claim_value"],
                raised_at=current_row["raised_at"],
                status=current_row["status"],
            )
            if current_row is not None
            else None
        )

        decision = classify(
            current=current,
            observed_value=obs.claim_value,
            observed_at=obs.known_at,
            now=now,
            kickoff_at=kickoff_at,
            conflict_window_minutes=conflict_window_minutes,
        )

        # --- non-actionable branches ------------------------------------
        if decision.action is Action.duplicate:
            db.bump_last_confirmed(cur, event_id=current_row["id"], at=obs.known_at)
            return ObservationResult(action="duplicate", source_event_id=current_row["id"])

        if decision.action is Action.conflict:
            merged = (
                f"{current_row['evidence_text']} | CONFLICTING: {obs.evidence_text}"
            )
            db.mark_conflicting(cur, event_id=current_row["id"], evidence_text=merged)
            return ObservationResult(action="conflict", source_event_id=current_row["id"])

        event_id = db.source_event_id(
            obs.source, obs.subject_player_id, obs.claim_type, obs.known_at
        )
        status = "post_kickoff" if decision.action is Action.post_kickoff else "active"
        db.insert_source_event(
            cur,
            event_id=event_id,
            source=obs.source,
            subject_player_id=obs.subject_player_id,
            game_id=obs.game_id,
            claim_type=obs.claim_type,
            claim_value=obs.claim_value,
            evidence_text=obs.evidence_text,
            status=status,
            valid_at=obs.known_at,
            known_at=obs.known_at,
            raised_at=obs.known_at,
            last_confirmed_at=obs.known_at,
            ingest_run_id=obs.ingest_run_id,
        )
        if decision.supersede_current and current_row is not None:
            db.supersede_event(
                cur, old_event_id=current_row["id"], new_event_id=event_id
            )

        if not decision.actionable:
            # post_kickoff: retained for source grading, never edits pre-game.
            return ObservationResult(action=decision.action.value, source_event_id=event_id)

        # Only an "out"-flavoured claim redistributes usage. An "active" reversal
        # supersedes the prior claim and stops blocking, but raises no new shadow.
        if obs.claim_value.lower() not in _OUT_VALUES:
            return ObservationResult(action="create_new", source_event_id=event_id)

        result = _raise_suggestions(
            cur,
            corpus_factory=corpus_factory,
            observation=obs,
            game=game,
            models=models,
            now=now,
            event_id=event_id,
            threshold_pp=threshold_pp,
            relative_pct=relative_pct,
            draw_count=draw_count,
        )
        result.action = "create_new"
        result.source_event_id = event_id
        return result


def _raise_suggestions(
    cur,
    *,
    corpus_factory: Callable[[datetime], AsOfCorpus],
    observation: Observation,
    game: dict,
    models: live.SimulationModels,
    now: datetime,
    event_id: str,
    threshold_pp: float,
    relative_pct: float,
    draw_count: int | None,
) -> ObservationResult:
    obs = observation
    out = ObservationResult(action="create_new")

    contracts = db.listed_contracts_for_game(cur, game_id=obs.game_id)
    if not contracts:
        # No listed contract in the whole game — nothing tradeable to move, so no
        # suggestion is surfaced even though the claim is retained for grading.
        return out

    # Requested universe: the contract-listed players, grouped by stat. The
    # subject need NOT be listed (OQ6) — he is still forced unavailable below.
    player_ids_by_stat: dict[str, list[str]] = {}
    thresholds_by_key: dict[tuple[str, str], list[float]] = {}
    for c in contracts:
        stat = c["stat_type"]
        player_ids_by_stat.setdefault(stat, [])
        if c["player_id"] not in player_ids_by_stat[stat]:
            player_ids_by_stat[stat].append(c["player_id"])
        if c["threshold"] is not None:
            thresholds_by_key.setdefault((c["player_id"], stat), []).append(
                float(c["threshold"])
            )

    stat_names = sorted(player_ids_by_stat)
    cutoff = obs.known_at
    corpus = corpus_factory(cutoff)

    sim_kwargs: dict[str, object] = {}
    if draw_count is not None:
        sim_kwargs["draw_count"] = draw_count
    shadow = live.simulate_game_adjusted(
        corpus,
        game=game,
        game_id=obs.game_id,
        stat_names=stat_names,
        player_ids_by_stat=player_ids_by_stat,
        cutoff=cutoff,
        computed_at=now,
        models=models,
        unavailable_player_ids=frozenset({obs.subject_player_id}),
        **sim_kwargs,
    )

    shadow_by_key = {
        (p.player_id, p.stat_type): p for p in shadow.projections
    }

    name_ids = {obs.subject_player_id}
    for stat, players in player_ids_by_stat.items():
        name_ids.update(players)
    names = db.player_names(cur, player_ids=list(name_ids))
    subject_name = names.get(obs.subject_player_id, obs.subject_player_id)

    for stat, players in player_ids_by_stat.items():
        for target in players:
            # TODO(SIG-81): batch these per-(target,stat) freshest-base reads
            # into one keyed query instead of one round-trip per contract.
            base = db.freshest_base_projection(
                cur, player_id=target, game_id=obs.game_id, stat_type=stat
            )
            if base is None:
                # Nothing displayed for this contract, so nothing to adjust.
                continue

            sid = db.suggestion_id(event_id, target, stat)
            target_name = names.get(target, target)
            key = (target, stat)

            if key not in shadow_by_key:
                # Decision 6: no shadow projection for a listed target that has a
                # base — whether the model explicitly declined (insufficient
                # evidence) OR the simulation produced neither a projection nor a
                # decline for it. Either way we cannot defensibly estimate the
                # redistribution, so raise an insufficient-evidence hold rather
                # than silently leaving the contract tradeable on a possibly-stale
                # base (review audit: closes a drop where the target was neither
                # projected nor declined).
                db.insert_suggestion(
                    cur,
                    row={
                        "id": sid,
                        "source_event_id": event_id,
                        "target_player_id": target,
                        "game_id": obs.game_id,
                        "stat_type": stat,
                        "base_projection_id": base["id"],
                        "shadow_projection_id": None,
                        "status": "insufficient_evidence",
                        "materiality_kind": KIND_UNLISTED_RELATIVE_PCT,
                        "material_threshold_pp": None,
                        "material_relative_pct": None,
                        "reason_text": (
                            f"{obs.source.upper()} reports {subject_name} inactive. "
                            f"Sightline cannot defensibly estimate {target_name}'s "
                            f"{stat.replace('_', ' ')} redistribution (insufficient "
                            f"history for the inheriting role); held from autonomous "
                            f"trading."
                        ),
                    },
                )
                out.insufficient_evidence += 1
                continue

            proj = shadow_by_key[key]

            base_dist = ProjectionDist(
                quantiles=_loads(base["quantiles"]),
                pmf=_loads(base["pmf"]),
                projected_value=float(base["projected_value"]),
            )
            shadow_dist = ProjectionDist(
                quantiles=proj.quantiles,
                pmf=proj.pmf,
                projected_value=float(proj.projected_value),
            )
            listed = thresholds_by_key.get(key, [])
            mat = evaluate_materiality(
                base=base_dist,
                shadow=shadow_dist,
                listed_thresholds=listed,
                threshold_pp=threshold_pp,
                relative_pct=relative_pct,
            )
            if not mat.material:
                continue

            shadow_id = db.shadow_projection_id(event_id, target, stat)
            db.insert_shadow_projection(
                cur,
                row={
                    "id": shadow_id,
                    "player_id": target,
                    "game_id": obs.game_id,
                    "stat_type": stat,
                    "model_version": SIMULATION_MODEL_VERSION,
                    "distribution_kind": proj.distribution_kind,
                    "params": proj.params,
                    "quantiles": proj.quantiles,
                    "pmf": proj.pmf,
                    "projected_value": proj.projected_value,
                    "projected_median": proj.projected_median,
                    "interval_low": proj.interval_low,
                    "interval_high": proj.interval_high,
                    "confidence": proj.confidence,
                    "n_eff": proj.n_eff,
                    "computed_at": now,
                    "information_cutoff": cutoff,
                    "adjustment_suggestion_id": sid,
                },
                drivers=list(proj.drivers),
            )
            out.shadows_persisted += 1

            reason = (
                f"{obs.source.upper()} reports {subject_name} inactive. Sightline's "
                f"simulation redistributes usage, moving {target_name}'s "
                f"{stat.replace('_', ' ')} projection from "
                f"{float(base['projected_value']):.1f} to {proj.projected_value:.1f}."
            )
            db.insert_suggestion(
                cur,
                row={
                    "id": sid,
                    "source_event_id": event_id,
                    "target_player_id": target,
                    "game_id": obs.game_id,
                    "stat_type": stat,
                    "base_projection_id": base["id"],
                    "shadow_projection_id": shadow_id,
                    "status": "pending",
                    "materiality_kind": mat.kind,
                    "material_threshold_pp": mat.threshold_pp,
                    "material_relative_pct": mat.relative_pct,
                    "reason_text": reason,
                },
            )
            out.suggestions_created += 1
            out.target_stats.append(f"{target}:{stat}")

    return out


def _loads(value):
    """Postgres jsonb may arrive already-parsed or as text; normalise to Python."""
    if value is None or isinstance(value, (dict, list)):
        return value
    return json.loads(value)
