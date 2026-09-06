// Prisma config (v7). Environment variables are NOT auto-loaded by the Prisma
// CLI in v7, so we load .env explicitly here.
//   - DATABASE_URL: transaction-pooler connection for application traffic
//   - DIRECT_URL:   direct (non-pooled) connection used by Prisma Migrate and
//                   by the Python runtime's bulk writes
// Prisma 7's config datasource accepts `url` and `shadowDatabaseUrl` ONLY —
// there is no `directUrl` here (that was Prisma 6's schema-level field). An
// unknown key is silently ignored, so setting `url` to the pooler sends
// migrations through transaction-mode pooling, where Migrate's session-scoped
// advisory lock never resolves and the command hangs with no error.
//
// The CLI is the only consumer of this datasource: the application client
// builds its own pooled connection from DATABASE_URL in src/lib/prisma.ts.
// So this points at the direct connection, and app traffic still pools.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
