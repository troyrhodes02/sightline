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
