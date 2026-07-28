# Sightline — Python runtime

Everything upstream of a stored projection: historical corpus ingest, provenance,
and (from a later PR) the as-of query layer. It reads and writes the Postgres
tables Prisma owns, over the **direct** (non-pooled) connection, and it **never
migrates** the schema.

## Setup

```bash
cd python
uv sync                      # create the venv and install deps
uv run sightline-ingest --help
```

## Environment

The runtime reads the repo-root `.env` (see `../.env.example`):

- `DIRECT_URL` — direct Supabase connection used for real ingest.
- `INGEST_DATABASE_URL` — optional explicit override.
- `TEST_DATABASE_URL` — local Postgres (Docker) used by the test suite.

## Tests

DB integration tests require `TEST_DATABASE_URL` pointing at a migrated Postgres.
Start the local test DB from the repo root and run:

```bash
docker compose up -d db                 # local Postgres on :5433
uv run --project python pytest          # from repo root, or `uv run pytest` in python/
```

Tests marked `db` are skipped automatically when `TEST_DATABASE_URL` is unset.

## Invariants enforced here

- **Prices never feed projections** — no module imports `PriceObservation` or
  `RecommendationSnapshot` (`tests/test_import_graph.py`).
- **Explicit failure** — an unavailable/drifted source records `IngestStatus.failed`
  and raises; never a partial dataset that reads as complete.
- **Credential safety** — no DSN or password ever reaches an `IngestRun.error_message`.
