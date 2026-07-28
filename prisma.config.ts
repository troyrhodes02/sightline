// Prisma config (v7). Environment variables are NOT auto-loaded by the Prisma
// CLI in v7, so we load .env explicitly here.
//   - DATABASE_URL: transaction-pooler connection for application traffic
//   - DIRECT_URL:   direct (non-pooled) connection used by Prisma Migrate and
//                   by the Python runtime's bulk writes
// Prisma Migrate uses `directUrl` when present, per Supabase's guidance that
// migrations run over the direct connection, not the transaction pooler.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
    directUrl: env("DIRECT_URL"),
  },
});
