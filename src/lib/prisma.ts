import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { serverEnv } from "@/env";

/**
 * The application's Prisma client.
 *
 * Connects through **`DATABASE_URL`, the transaction-mode pooler** — not
 * `DIRECT_URL`. The direct connection belongs to Prisma Migrate and to the
 * Python runtime's bulk writes; routing request traffic through it would
 * exhaust Postgres connections under serverless invocation.
 *
 * A single instance is cached on `globalThis` in development so Next's hot
 * reload does not open a new pool on every edit.
 *
 * `server-only` is the real guard against a browser import — it turns one into
 * a build error. A lint path rule cannot do the same job, because Server
 * Components are also `.tsx` and read through Prisma legitimately.
 */

const globalForPrisma = globalThis as unknown as {
  sightlinePrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const env = serverEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.sightlinePrisma ?? createClient();

if (serverEnv().NODE_ENV !== "production") {
  globalForPrisma.sightlinePrisma = prisma;
}
