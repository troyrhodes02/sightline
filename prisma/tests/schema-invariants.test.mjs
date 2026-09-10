// Schema-introspection invariant tests (SIG-5, AC #2 / AC #10-adjacent).
//
// These run WITHOUT a database: they parse prisma/schema.prisma (the single
// source of schema truth) and the generated initial migration, and assert the
// structural guarantees the temporal invariant depends on. DB-layer behavioural
// tests (that the CHECK constraints actually reject bad rows) live in the Python
// suite once a database exists — they cannot pass here because there is no DB
// yet. What we CAN prove offline is that the columns and constraints are present
// and shaped correctly, which is exactly what "a new fact table without both
// columns is a schema bug" requires a guard for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const schema = readFileSync(join(repoRoot, "prisma", "schema.prisma"), "utf8");

// Concatenate EVERY migration in order, so constraints added or dropped by
// later migrations are visible to these assertions.
const migrationsDir = join(repoRoot, "prisma", "migrations");
const migration = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8"))
  .join("\n");

// The FACT tables governed by the temporal invariant. Corrections
// (player_game_stat_corrections) are a version log with correction_known_at, not
// a validAt/knownAt fact table, and reference/provenance tables carry neither —
// so they are deliberately excluded here.
const FACT_TABLES = [
  "play_by_play",
  "player_game_stats",
  "player_game_context",
  "game_weather",
  "game_schedule_revisions",
  // A recorded external source claim (ESPN inactives) is a bitemporal fact:
  // valid_at is the source's effective time, known_at when Sightline ingested
  // it. It carries ingest_run_id, so the temporal trio is required.
  "adjustment_source_events",
];

// Fact tables where known_at >= valid_at is deliberately NOT enforced.
// game_weather stores forecasts, which are known BEFORE the window they
// describe — known_at < valid_at is the legitimate shape.
const KNOWN_BEFORE_VALID_OK = ["game_weather"];

// Tables that reference an IngestRun but are deliberately NOT bitemporal fact
// tables, with the reason. Anything else carrying ingest_run_id must be in
// FACT_TABLES — that is what makes this guard self-extending.
const INGESTED_NON_FACT_TABLES = new Map([
  [
    "player_game_stat_corrections",
    "append-only version log; its availability column is correction_known_at",
  ],
]);

/** Parse `model X { ... }` blocks into { name, dbName, body, fields }. */
function parseModels(src) {
  const models = new Map();
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const dbNameMatch = body.match(/@@map\("([^"]+)"\)/);
    const dbName = dbNameMatch ? dbNameMatch[1] : name;
    // A field line starts with an identifier then a type; skip block-level
    // attribute lines (@@) and comment-only lines.
    const fields = new Map();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fm = line.match(/^(\w+)\s+([\w.]+)(\??)/);
      if (!fm) continue;
      const [, fname, ftype, optional] = fm;
      fields.set(fname, { type: ftype, required: optional !== "?", line });
    }
    models.set(dbName, { name, dbName, body, fields });
  }
  return models;
}

const modelsByTable = parseModels(schema);

test("every fact table carries non-nullable validAt, knownAt, knownAtReconstructed", () => {
  for (const table of FACT_TABLES) {
    const model = modelsByTable.get(table);
    assert.ok(model, `fact table ${table} not found in schema`);

    const validAt = model.fields.get("validAt");
    const knownAt = model.fields.get("knownAt");
    const reconstructed = model.fields.get("knownAtReconstructed");

    assert.ok(validAt, `${table} is missing validAt`);
    assert.ok(knownAt, `${table} is missing knownAt`);
    assert.ok(reconstructed, `${table} is missing knownAtReconstructed`);

    assert.equal(validAt.type, "DateTime", `${table}.validAt must be DateTime`);
    assert.equal(knownAt.type, "DateTime", `${table}.knownAt must be DateTime`);
    assert.equal(
      reconstructed.type,
      "Boolean",
      `${table}.knownAtReconstructed must be Boolean`,
    );

    assert.ok(validAt.required, `${table}.validAt must be non-nullable`);
    assert.ok(knownAt.required, `${table}.knownAt must be non-nullable`);
    assert.ok(
      reconstructed.required,
      `${table}.knownAtReconstructed must be non-nullable`,
    );
  }
});

test("every fact table maps its temporal columns to snake_case", () => {
  const expected = {
    validAt: "valid_at",
    knownAt: "known_at",
    knownAtReconstructed: "known_at_reconstructed",
  };
  for (const table of FACT_TABLES) {
    const model = modelsByTable.get(table);
    for (const [field, column] of Object.entries(expected)) {
      const { line } = model.fields.get(field);
      assert.match(
        line,
        new RegExp(`@map\\("${column}"\\)`),
        `${table}.${field} must @map to ${column}`,
      );
    }
  }
});

test("known_at >= valid_at CHECK constraint exists for every fact table", () => {
  for (const table of FACT_TABLES) {
    if (KNOWN_BEFORE_VALID_OK.includes(table)) continue;
    const re = new RegExp(
      `ALTER TABLE "${table}"[\\s\\S]*?CHECK \\("known_at" >= "valid_at"\\)`,
    );
    assert.match(
      migration,
      re,
      `migration is missing known_at >= valid_at CHECK on ${table}`,
    );
  }
});

test("game_weather's known_at >= valid_at CHECK is explicitly dropped, not merely absent", () => {
  // Forecasts are known before the window they describe. The init migration
  // added the CHECK; the fix migration must drop it deliberately so the
  // exemption is a recorded decision, not an accident.
  assert.match(
    migration,
    /ALTER TABLE "game_weather" DROP CONSTRAINT "weather_known_after_valid"/,
    "game_weather must explicitly drop weather_known_after_valid",
  );
});

test("every table referencing IngestRun is a declared fact table or a documented exception", () => {
  // Self-extending guard: a future ingested table added without the
  // bitemporal trio must fail HERE, not slip past a hardcoded list.
  for (const [table, model] of modelsByTable) {
    const referencesIngestRun = /@map\("ingest_run_id"\)/.test(model.body);
    if (!referencesIngestRun) continue;
    const declared =
      FACT_TABLES.includes(table) || INGESTED_NON_FACT_TABLES.has(table);
    assert.ok(
      declared,
      `${table} carries ingest_run_id but is neither in FACT_TABLES (bitemporal ` +
        `trio enforced) nor a documented non-fact exception — a new fact table ` +
        `without validAt/knownAt is a schema bug`,
    );
  }
});

test("Player has no current-team / roster-state column (structural, AC #8)", () => {
  const player = modelsByTable.get("players");
  assert.ok(player, "players model not found");
  for (const forbidden of [
    "currentTeam",
    "currentTeamId",
    "teamId",
    "team",
    "teamAbbr",
  ]) {
    assert.ok(
      !player.fields.has(forbidden),
      `Player must not carry ${forbidden}; team affiliation is per-game context`,
    );
  }
});

test("identity-resolution consistency and dome constraints are present", () => {
  assert.match(
    migration,
    /CONSTRAINT "external_id_resolution_consistent" CHECK/,
    "missing external_id_resolution_consistent constraint",
  );
  assert.match(
    migration,
    /CONSTRAINT "weather_dome_has_no_values" CHECK/,
    "missing weather_dome_has_no_values constraint",
  );
});

test("backtest result tables are not bitemporal fact tables", () => {
  // A backtest result is a measurement of the model, not a fact about the
  // world. It must not acquire validAt/knownAt by imitation — those columns
  // would be meaningless here and would dilute what the temporal trio means
  // everywhere else.
  for (const table of ["backtest_runs", "calibration_bins"]) {
    const model = modelsByTable.get(table);
    assert.ok(model, `${table} not found in schema`);
    for (const field of ["validAt", "knownAt", "knownAtReconstructed"]) {
      assert.ok(
        !model.fields.has(field),
        `${table} must not carry ${field} — it is not a fact table`,
      );
    }
    assert.ok(
      !/@map\("ingest_run_id"\)/.test(model.body),
      `${table} must not carry ingest_run_id`,
    );
  }
});

test("calibration segment constraints and completion invariants exist", () => {
  // The generated unique index cannot prevent duplicate "all" segment rows,
  // because Postgres treats NULLs as distinct. The partial indexes plus the
  // single-axis CHECK are what actually close it.
  for (const name of [
    "calibration_bins_single_axis",
    "calibration_bins_bounds",
    "backtest_runs_population_reconciles",
    "backtest_runs_completed_has_digests",
  ]) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT "${name}" CHECK`),
      `migration is missing the ${name} constraint`,
    );
  }
  for (const index of [
    "calibration_bins_all_segment_uniq",
    "calibration_bins_stat_segment_uniq",
    "calibration_bins_season_segment_uniq",
    "calibration_bins_era_segment_uniq",
  ]) {
    assert.match(
      migration,
      new RegExp(`CREATE UNIQUE INDEX "${index}"`),
      `migration is missing the ${index} partial unique index`,
    );
  }
});

test("no enum-cast expression index was reintroduced", () => {
  // COALESCE(stat_type::text, '*') reads like the obvious fix and Postgres
  // rejects it: enum output is STABLE, not IMMUTABLE. Guarding it keeps the
  // next person from rediscovering that at migrate-deploy time.
  // Comments are stripped first: the migration explains the rejected form in
  // prose, and a guard that fired on its own explanation would be useless.
  const executable = migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.ok(
    !/COALESCE\(\s*"?\w+"?::text/i.test(executable),
    "an enum-to-text cast appears inside an index/constraint expression",
  );
});

test("PlayerExternalId keeps player_id nullable so unresolved ids are retained", () => {
  const ext = modelsByTable.get("player_external_ids");
  assert.ok(ext, "player_external_ids model not found");
  assert.equal(
    ext.fields.get("playerId").required,
    false,
    "playerId must be nullable — unresolved/ambiguous ids carry no player",
  );
});

// ---------------------------------------------------------------------------
// Pitch 4 — market, projection, and decision tables (SIG-39)
// ---------------------------------------------------------------------------

const PITCH4_TABLES = [
  "contracts",
  "market_sync_runs",
  "price_observations",
  "projections",
  "projection_drivers",
  "recommendation_snapshots",
  "decisions",
];

test("pitch 4 tables exist and are not bitemporal fact tables", () => {
  // Contracts and prices are market metadata the model never reads (prices
  // never feed projections); projections are model OUTPUT; snapshots and
  // decisions are product history. None may acquire the temporal trio or an
  // ingest_run_id by imitation.
  for (const table of PITCH4_TABLES) {
    const model = modelsByTable.get(table);
    assert.ok(model, `${table} not found in schema`);
    for (const field of ["validAt", "knownAt", "knownAtReconstructed"]) {
      assert.ok(
        !model.fields.has(field),
        `${table} must not carry ${field} — it is not a fact table`,
      );
    }
    assert.ok(
      !/@map\("ingest_run_id"\)/.test(model.body),
      `${table} must not carry ingest_run_id`,
    );
  }
});

test("edge is a view, not a record: no derived-state column on contracts", () => {
  // Live edge, staleness, and recommendation state are computed on read.
  // A column for any of them is the denormalisation CLAUDE.md forbids.
  const contract = modelsByTable.get("contracts");
  for (const forbidden of [
    "edge",
    "edgePoints",
    "confidenceAdjustedEdge",
    "isStale",
    "stale",
    "isRecommended",
    "recommended",
  ]) {
    assert.ok(
      !contract.fields.has(forbidden),
      `contracts must not carry ${forbidden} — edge/staleness/recommendation are computed on read`,
    );
  }
});

test("decisions carry the full server-read snapshot and direct user ownership", () => {
  const decision = modelsByTable.get("decisions");
  assert.ok(decision, "decisions model not found");
  for (const field of [
    "userId",
    "disposition",
    "snapshotModelProbability",
    "snapshotAskCents",
    "snapshotEdgePoints",
    "snapshotConfidence",
    "snapshotIsRecommended",
    "snapshotProjectionComputedAt",
    "snapshotInformationCutoff",
    "snapshotPriceObservedAt",
    "decidedAt",
  ]) {
    assert.ok(decision.fields.has(field), `decisions is missing ${field}`);
  }
  // Anchored to the contract, not to a recommendation: contractId required,
  // and there is deliberately NO recommendation-snapshot foreign key required.
  assert.ok(
    decision.fields.get("contractId").required,
    "decisions.contractId must be non-nullable — decisions anchor to contracts",
  );
  assert.ok(
    decision.fields.get("userId").required,
    "decisions.userId must be non-nullable — ownership is direct, from the session",
  );
});

test("price observations are append-only by construction", () => {
  const obs = modelsByTable.get("price_observations");
  assert.ok(obs, "price_observations model not found");
  assert.ok(
    !obs.fields.has("updatedAt"),
    "price_observations must not carry updatedAt — observations are never updated",
  );
  // Both sides of the book, never a midpoint column.
  for (const field of ["yesBidCents", "yesAskCents", "noBidCents", "noAskCents"]) {
    assert.ok(obs.fields.has(field), `price_observations is missing ${field}`);
  }
  assert.ok(
    !obs.fields.has("midCents"),
    "price_observations must not store a midpoint — it is derivable",
  );
});

// ---------------------------------------------------------------------------
// Outcome Scoring & Accuracy Surface — settlement and grade tables (SIG-51)
// ---------------------------------------------------------------------------

const GRADING_TABLES = ["outcomes", "projection_grades", "threshold_grades"];

test("settlement and grade tables are measurement records, not bitemporal fact tables", () => {
  // An outcome is a measurement of a market and a grade is a measurement of
  // the model — neither is a fact about the world, and neither may ever feed
  // a projection. They deliberately carry no validAt/knownAt (like
  // backtest_runs) and no ingest_run_id, which also keeps them outside the
  // self-extending fact-table guard above.
  for (const table of GRADING_TABLES) {
    const model = modelsByTable.get(table);
    assert.ok(model, `${table} not found in schema`);
    for (const field of ["validAt", "knownAt", "knownAtReconstructed"]) {
      assert.ok(
        !model.fields.has(field),
        `${table} must not carry ${field} — it is not a fact table`,
      );
    }
    assert.ok(
      !/@map\("ingest_run_id"\)/.test(model.body),
      `${table} must not carry ingest_run_id`,
    );
  }
});

test("settlement lives on outcomes, never as columns on contracts", () => {
  // The contract row is market identity; its settlement is a separate record
  // with its own provenance and supersession history. A settlement (or any
  // grade-derived) column on contracts would be the stored-derived-state
  // denormalisation CLAUDE.md forbids, and would tempt read paths into
  // treating one truth as THE truth.
  const contract = modelsByTable.get("contracts");
  for (const forbidden of [
    "result",
    "settled",
    "settledAt",
    "settlementResult",
    "outcomeResult",
    "isSettled",
    "graded",
  ]) {
    assert.ok(
      !contract.fields.has(forbidden),
      `contracts must not carry ${forbidden} — settlement lives on outcomes`,
    );
  }
});

test("outcome supersession provenance and grade coherence CHECKs exist", () => {
  for (const name of [
    "outcomes_supersession_provenance",
    "threshold_grades_market_has_contract",
    "projection_grades_status_values",
  ]) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT "${name}"[\\s\\S]{0,200}?CHECK`),
      `migration is missing the ${name} constraint`,
    );
  }
});

test("outcomes retain supersession provenance fields and one row per contract", () => {
  const outcome = modelsByTable.get("outcomes");
  assert.ok(outcome, "outcomes model not found");
  for (const field of [
    "result",
    "settledAt",
    "recordedAt",
    "rawResult",
    "supersededCount",
    "previousResult",
    "previousRecordedAt",
  ]) {
    assert.ok(outcome.fields.has(field), `outcomes is missing ${field}`);
  }
  assert.match(
    outcome.fields.get("contractId").line,
    /@unique/,
    "outcomes.contractId must be unique — one settlement per contract",
  );
  // Settlement retention is independent of resolution and projection state:
  // the row references the contract and nothing else.
  assert.ok(
    !outcome.fields.has("projectionId"),
    "outcomes must not reference a projection — settlement retention and grading are separate",
  );
});

test("projections carry both clocks and the idempotent persist key", () => {
  const projection = modelsByTable.get("projections");
  assert.ok(projection, "projections model not found");
  const computedAt = projection.fields.get("computedAt");
  const cutoff = projection.fields.get("informationCutoff");
  assert.ok(computedAt?.required, "projections.computedAt must be non-nullable");
  assert.ok(cutoff?.required, "projections.informationCutoff must be non-nullable");
  // Adjustment Suggestions (SIG-74) joins `provenance` to the persist key so an
  // adjustment_shadow projection can never collide with a base sharing a cutoff.
  // Base rows default to `base`, so this preserves the original idempotency.
  assert.match(
    projection.body,
    /@@unique\(\[playerId, gameId, statType, modelVersion, informationCutoff, provenance\]\)/,
    "projections must have the idempotent persist unique key (incl. provenance)",
  );
});

test("projections discriminate base from shadow provenance and default to base", () => {
  const projection = modelsByTable.get("projections");
  assert.ok(projection, "projections model not found");
  const provenance = projection.fields.get("provenance");
  assert.ok(provenance, "projections must carry a provenance discriminator");
  assert.equal(
    provenance.type,
    "ProjectionProvenance",
    "provenance must be the ProjectionProvenance enum",
  );
  assert.match(
    projection.body,
    /provenance\s+ProjectionProvenance\s+@default\(base\)/,
    "provenance must default to base so existing/ordinary projections are base",
  );
});

// ---------------------------------------------------------------------------
// Autonomous paper trading (SIG-60)
// ---------------------------------------------------------------------------

const PAPER_TABLES = [
  "paper_campaigns",
  "paper_risk_configs",
  "paper_control_events",
  "paper_ledger_entries",
  "paper_cycles",
  "paper_cycle_candidates",
  "paper_positions",
  "paper_fills",
  "paper_desired_exposures",
  "paper_breaches",
  "paper_dry_runs",
  "paper_replays",
  "paper_replay_mode_results",
  "recalibration_fits",
];

test("paper trading tables exist and are not bitemporal fact tables", () => {
  // A bankroll is an account record, not a fact about the world. None of these
  // may acquire the temporal trio or an ingest_run_id by imitation — and
  // nothing here may ever feed a projection.
  for (const table of PAPER_TABLES) {
    const model = modelsByTable.get(table);
    assert.ok(model, `${table} not found in schema`);
    for (const field of ["validAt", "knownAt", "knownAtReconstructed"]) {
      assert.ok(
        !model.fields.has(field),
        `${table} must not carry ${field} — it is not a fact table`,
      );
    }
    assert.ok(
      !/@map\("ingest_run_id"\)/.test(model.body),
      `${table} must not carry ingest_run_id`,
    );
  }
});

test("paper and live ledgers cannot be aggregated: there is no live ledger", () => {
  // THE separation guarantee, expressed structurally rather than as a
  // convention every future query has to remember. Paper and live P&L never
  // merging is a No-Go; the way this codebase keeps it is by not having a
  // second ledger to merge with, and by refusing a mode column that a
  // forgotten WHERE clause could leak across.
  //
  // When Kalshi Trading adds live tables it must add them as their OWN models
  // (LivePosition, LiveLedgerEntry, ...) and update this test deliberately —
  // which is the review moment this assertion exists to force.
  const LEDGER_SHAPED = [
    "balance_after_cents",
    "cost_basis_cents",
    "starting_bankroll_cents",
    "high_water_mark_cents",
    "realized_pnl_cents",
  ];

  for (const [table, model] of modelsByTable) {
    const isLedgerShaped = LEDGER_SHAPED.some((col) =>
      new RegExp('@map\\("' + col + '"\\)').test(model.body),
    );
    if (!isLedgerShaped) continue;

    assert.ok(
      table.startsWith("paper_"),
      `${table} holds ledger-shaped money but is not a paper_* table — a ` +
        `live ledger must be its own model family, never a sibling column`,
    );

    // No mode/ledger discriminator anywhere on a ledger-shaped table. This is
    // the column that would make a sum span both books.
    for (const banned of [
      "ledger_mode",
      "ledgerMode",
      "is_live",
      "isLive",
      "is_paper",
      "isPaper",
      "account_mode",
      "accountMode",
      "operating_mode",
      "operatingMode",
    ]) {
      assert.ok(
        !model.body.includes(banned),
        `${table} must not carry a paper/live discriminator (${banned}) — ` +
          `separation is structural, not a filter`,
      );
    }
  }
});

test("no live ledger model exists yet", () => {
  // Live order placement, fills, and the funded bankroll belong to the Kalshi
  // Trading pitch. A model appearing here early would mean paper and live
  // became aggregable before anyone decided they should be.
  for (const [table, model] of modelsByTable) {
    assert.ok(
      !/^live_/.test(table),
      `${table} exists but live trading is not in scope yet`,
    );
    assert.ok(
      !/^Live[A-Z]/.test(model.name),
      `${model.name} exists but live trading is not in scope yet`,
    );
  }
});

test("the fill guards are enforced in the database, not only in code", () => {
  // Paper trading exists to produce honest evidence. The most likely way that
  // evidence gets corrupted is a well-meaning optimisation that walks the book
  // or assumes unseen depth — so the rule lives where application code cannot
  // relax it.
  assert.match(
    migration,
    /paper_cycle_candidates_fill_within_book/,
    "missing the CHECK that a fill cannot exceed the observed top-of-book size",
  );
  assert.match(
    migration,
    /paper_cycle_candidates_fill_within_intent/,
    "missing the CHECK that a fill cannot exceed the intended size",
  );
  assert.match(
    migration,
    /"filled_contracts" <= "top_of_book_size_contracts"/,
    "the top-of-book CHECK must compare filled against observed size",
  );
});

test("breach and risk-config constraints exist", () => {
  assert.match(
    migration,
    /paper_breaches_one_active_per_condition/,
    "missing the partial unique index for one active breach per condition",
  );
  assert.match(
    migration,
    /paper_breaches_resolution_provenance/,
    "a resolved breach must carry its resolver and time",
  );
  assert.match(
    migration,
    /recalibration_fits_one_active_per_model/,
    "missing the partial unique index for one active fit per model version",
  );
  assert.match(
    migration,
    /paper_risk_configs_bounds/,
    "missing the risk-config bounds CHECK",
  );
  assert.match(
    migration,
    /"drawdown_halt_pct" > "drawdown_warn_pct"/,
    "the halt must sit above the warning or the warning can never fire",
  );
});

test("risk configuration is append-only by construction", () => {
  // "Changing mode applies to the next sizing decision; open positions keep
  // the limits they were created under" is only true if a config version is
  // never edited. A row with no updatedAt is a row nothing is expected to
  // update, and every consumer references it by id.
  const config = modelsByTable.get("paper_risk_configs");
  assert.ok(config, "paper_risk_configs not found");
  assert.ok(
    !config.fields.has("updatedAt"),
    "paper_risk_configs must not carry updatedAt — versions are appended, " +
      "never edited, or historical cycles would silently re-describe themselves",
  );
  for (const consumer of [
    "paper_cycles",
    "paper_positions",
    "paper_breaches",
    "paper_dry_runs",
  ]) {
    const model = modelsByTable.get(consumer);
    assert.ok(
      model.fields.has("riskConfigId"),
      `${consumer} must record the risk config it ran under`,
    );
  }
});

test("dry runs and replays are separate tables from the ledger", () => {
  // A dry run creates no position and alters no bankroll; a replay must never
  // be readable as real. Separate tables make both structural rather than a
  // filter every future aggregate has to remember.
  for (const table of [
    "paper_dry_runs",
    "paper_replays",
    "paper_replay_mode_results",
  ]) {
    const model = modelsByTable.get(table);
    assert.ok(model, `${table} not found`);
    assert.ok(
      !model.fields.has("positionId"),
      `${table} must not reference a position`,
    );
  }
  const cycle = modelsByTable.get("paper_cycles");
  assert.ok(
    !cycle.fields.has("trigger"),
    "paper_cycles must not carry a scheduled/dry-run trigger discriminator — " +
      "dry runs live in their own table",
  );
});

test("the candidate audit row can never lose its binding constraint", () => {
  // The bound-by field is the audit trail this whole feature exists to produce.
  const candidate = modelsByTable.get("paper_cycle_candidates");
  assert.ok(candidate, "paper_cycle_candidates not found");
  const boundBy = candidate.fields.get("boundBy");
  assert.ok(boundBy?.required, "boundBy must be non-nullable");
  assert.equal(boundBy.type, "BindingConstraint");
  // Intended and filled are two fields, always both.
  for (const field of [
    "intendedStakeCents",
    "intendedContracts",
    "filledContracts",
    "filledCostCents",
  ]) {
    assert.ok(candidate.fields.has(field), `candidate is missing ${field}`);
  }
});

test("a paper position keeps the intended stake beside the actual cost", () => {
  const position = modelsByTable.get("paper_positions");
  assert.ok(position, "paper_positions not found");
  for (const field of [
    "costBasisCents",
    "feesPaidCents",
    "intendedStakeCents",
  ]) {
    assert.ok(
      position.fields.get(field)?.required,
      `paper_positions.${field} must be non-nullable — the ledger may never ` +
        `present the wished-for stake as the actual one, or lose it`,
    );
  }
  assert.match(
    position.body,
    /@@unique\(\[campaignId, contractId\]\)/,
    "one position per contract per campaign; increments accumulate onto it",
  );
});
