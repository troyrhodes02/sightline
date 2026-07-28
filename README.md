# Sightline

Sightline tells its admin which of today's Kalshi NFL player-prop contracts
are mispriced, and how much to trust that judgment. Invite-only; one admin, a
handful of viewers. See `docs/planning/` for the product brief, PRD,
architecture, and pitch roadmap, and `.claude/CLAUDE.md` for the project's
working invariants.

Two runtimes share one Postgres database and communicate through it and
nowhere else:

- **`prisma/`** — the single source of schema truth (TypeScript application
  lands in a later pitch). Migrations originate here, always.
- **`python/`** — the ingest/modelling runtime (`uv`-managed). It reads and
  writes the tables Prisma owns but never migrates them. See
  `python/README.md`.

## Development

```sh
npm ci                    # Prisma CLI + schema test deps
npm run prisma:validate   # validate prisma/schema.prisma
npm run test:schema       # offline schema-invariant tests (node --test)
```

Python tests (see `docker-compose.yml` for a local Postgres; set
`TEST_DATABASE_URL`, apply migrations with `npx prisma migrate deploy`):

```sh
cd python
uv sync
uv run pytest -q
```

Environment variables are documented in `.env.example`.
