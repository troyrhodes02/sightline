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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const schema = readFileSync(join(repoRoot, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    repoRoot,
    "prisma",
    "migrations",
    "20260727000000_init_corpus_schema",
    "migration.sql",
  ),
  "utf8",
);

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

test("PlayerExternalId keeps player_id nullable so unresolved ids are retained", () => {
  const ext = modelsByTable.get("player_external_ids");
  assert.ok(ext, "player_external_ids model not found");
  assert.equal(
    ext.fields.get("playerId").required,
    false,
    "playerId must be nullable — unresolved/ambiguous ids carry no player",
  );
});
