# Runbook — Adjustment Suggestions & Source Reliability

Everything needed to operate ESPN inactives as the first Adjustment Suggestions
source that lives **outside the codebase** — configuration, cadence, outage
detection, and after-the-fact inspection. For what the feature does and why, see
the pitch, design doc, and spec under `docs/v1/`.

The one thing to hold onto: **ESPN is a proposal engine, not an authority.** It
never changes a projection on its own. If it breaks, the correct behaviour is
that suggestions stop and affected games display as honestly stale — not that
anything fails.

---

## 1. ESPN endpoint configuration

ESPN's inactives feed is **undocumented, unauthenticated, and unsupported** — it
carries no stability guarantee and can change shape without notice. It is wired
as an **optional** ingest source precisely so that its failure is survivable.

Configure one environment variable (Vercel project env, and any GitHub Actions
job env that runs the cycle):

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `SIGHTLINE_ESPN_INACTIVES_URL` | The inactives endpoint the client fetches | **If unset, ESPN inactives are disabled** — the source records an explicit failure and the cycle still succeeds. Setting it to empty is the supported "off" switch. |

There is **no API key** — ESPN's endpoints are unauthenticated. Do not add one; a
credential field for ESPN is a review-blocking finding. The Kalshi signing key is
unrelated and must never appear near this feed.

The client (`python/src/sightline_ingest/datasets/espn_inactives.py`) is
schema-tolerant: it reads defensively and, if a non-empty payload yields no
parseable records, **raises** (recorded as a failed ingest run) rather than
silently reporting an empty, falsely-healthy run. A changed ESPN schema therefore
surfaces as a source failure to investigate, not a silent gap.

---

## 2. Polling cadence

ESPN inactives run as an **optional source inside the existing GitHub Actions
cycle** (`sightline_ingest.cycle`) and the game-day dispatcher — the same
schedule that already runs schedule/pbp/stats/context/weather. There is **no new
cron entry and no new worker**; the source is appended to `OPTIONAL_SOURCES` and
`GAMEDAY_OPTIONAL_SOURCES` and runs last so a slow undocumented feed never delays
the required nightly facts.

- The nightly in-week cycle picks it up automatically.
- The game-day dispatcher (kickoff-window ticks) runs it alongside the other
  fast-moving pre-kickoff facts (schedule, context, weather), which is where it
  matters most — inactives land in the final ~90 minutes before kickoff.
- Cadence is therefore whatever the cycle/dispatcher cadence already is. There is
  **no per-second polling** and no persistent connection; this is a person
  checking a phone before kickoff, not a market-making socket.
- Reminder of the platform edge (from `CLAUDE.md`): GitHub Actions has no timing
  SLA and disables schedules after 60 days without a commit to the default
  branch. The existing keepalive workflow and staleness disclosure already cover
  this; ESPN inactives inherit both.

---

## 3. Detecting an ESPN outage — and confirming the rest of the slate is unaffected

**What an outage looks like.** When ESPN is unreachable, times out, or returns an
unparseable payload, the `espn_inactives` source records an `IngestRun` with
`status = failed`. Because it is an **optional** source, the enclosing cycle
still finishes `succeeded` — one source's outage never fails the cycle or
conceals another source's state.

**Where to see it.**

1. **Health surface / pipeline history first.** The failed per-source `IngestRun`
   is visible in the pipeline run history for the cycle. Look for
   `dataset = 'espn_inactives'`, `status = 'failed'`.
   ```sql
   select ir.dataset, ir.status, ir.error_message, ir.started_at, pr.status as cycle_status
     from ingest_runs ir
     join pipeline_runs pr on pr.id = ir.pipeline_run_id
    where ir.dataset = 'espn_inactives'
    order by ir.started_at desc
    limit 20;
   ```
   A healthy row is `success` (or `partial` when some reports were unresolved and
   skipped); an outage is `failed` with a sanitized `error_message`.

**Confirming the rest of the slate is unaffected (the point of the optional
design).** After observing an ESPN failure:

- Confirm the **cycle itself succeeded**: the joined `cycle_status` above should
  be `succeeded`. If it is, the required sources (schedule/pbp/stats/context) all
  ran — one outage did not conceal another.
- Confirm **projections still updated**: the slate reads projections and prices
  independently of ESPN. The affected games simply show no *new* suggestions and
  fall back to the existing **Pitch 5 staleness disclosure** — a game past its
  inactives boundary displays as *predates inactives / stale* rather than
  pretending to be current. That is the honest, intended state.
- Do **not** interpret price movement as a substitute status signal. Kalshi price
  movement is never used to infer whether a player is in or out — under any
  framing, including a degraded-mode workaround. If ESPN is down, affected games
  stay stale until ESPN returns or William resolves manually.

**Recovery.** When ESPN returns, the next cycle resumes producing suggestions.
Re-publishing the same inactive list does **not** create duplicate suggestions:
an identical repeat only bumps the claim's last-confirmed timestamp (the
`(source, subject_player, claim_type)` dedup identity). So there is no "flood of
duplicate stale suggestions" on recovery — nothing to clean up.

---

## 4. Inspecting the suggestion & shadow-projection history for a player

Everything is retained: source claims, per-projection suggestions, and the shadow
projections themselves. Nothing is deleted on decline, reversal, or supersession.

Resolve the player id first (by name):
```sql
select id, full_name from players where full_name ilike '%chase%';
```

**Source claims about a player** (what ESPN said, and whether it proved correct):
```sql
select e.id, e.claim_type, e.claim_value, e.status, e.source_outcome,
       e.known_at, e.raised_at, e.last_confirmed_at, e.superseded_by_id, g.season, g.week
  from adjustment_source_events e
  join games g on g.id = e.game_id
 where e.subject_player_id = :player_id
 order by e.known_at desc;
```
- `status`: `active` (current), `superseded` (a reversal replaced it — follow
  `superseded_by_id`), `conflicting` (two contradictory unconfirmed reports), or
  `post_kickoff` (arrived after kickoff; retained for grading, never actionable).
- `source_outcome`: `correct` / `incorrect` (graded against official snap
  participation, never Kalshi settlement) / `unverifiable` (participation not
  ingested) / null (not yet graded, or a claim like "questionable" that asserts
  neither).

**Suggestions that a player's inactivity produced** (the per-teammate proposals):
```sql
select s.id, tp.full_name as target, s.stat_type, s.status,
       s.materiality_kind, s.material_threshold_pp, s.material_relative_pct,
       s.base_projection_id, s.shadow_projection_id, s.decided_at, s.reason_text
  from adjustment_suggestions s
  join adjustment_source_events e on e.id = s.source_event_id
  join players tp on tp.id = s.target_player_id
 where e.subject_player_id = :player_id
 order by s.created_at desc;
```

**Suggestions and shadows targeting a player** (proposals that would move HIS
projection):
```sql
select s.id, s.status, s.stat_type, s.base_projection_id, s.shadow_projection_id,
       e.source, e.claim_value, sp.full_name as subject
  from adjustment_suggestions s
  join adjustment_source_events e on e.id = s.source_event_id
  join players sp on sp.id = e.subject_player_id
 where s.target_player_id = :player_id
 order by s.created_at desc;
```

**The base vs shadow projections themselves, and how each graded** (the whole
point of the mechanism — telling a bad source from a bad model response):
```sql
select p.id, p.provenance, p.projected_value, p.information_cutoff, p.computed_at,
       pg.status as grade_status, pg.official_value, pg.abs_error_mean
  from projections p
  left join projection_grades pg on pg.projection_id = p.id
 where p.id in (:base_projection_id, :shadow_projection_id);
```
- The `base` row is what would have been predicted ignoring ESPN; the
  `adjustment_shadow` row is the what-if with the player marked out. Both are
  graded against the official line. Compare `abs_error_mean`: a lower shadow
  error means reacting improved the projection (Adjustment Accuracy); the source
  being right is a separate question (`source_outcome` above).

**Reliability roll-up** is on the admin Suggestions ▸ Reliability surface;
Source Accuracy and Adjustment Accuracy are shown as two separate figures, each
with its sample size and each withheld as a numeric rate below 15 observations.

---

## 5. Numeric defaults flagged for human review

Two values in this feature were **not** specified in the approved planning docs
and are this run's chosen defaults, flagged for explicit review (they live in
`python/src/sightline_model/suggestions/constants.py` and
`src/lib/suggestions/config.ts`, mirrored):

- `CONFLICT_WINDOW_MINUTES = 5` — the window within which two contradictory,
  still-unconfirmed reports are treated as *conflicting* rather than a reversal.
- `RELIABILITY_MIN_SAMPLE = 15` — the minimum verifiable observations before a
  numeric reliability rate is shown (applied independently to each of the two
  figures).

Change both runtimes together if either is adjusted.
