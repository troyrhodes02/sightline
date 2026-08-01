import { join } from "node:path";
import { readCode } from "@/lib/testing/source";

/**
 * The application must reach Postgres through the transaction pooler.
 *
 * `DIRECT_URL` belongs to Prisma Migrate and to the Python runtime's bulk
 * writes. Routing request traffic through it would exhaust Postgres connections
 * under serverless invocation — a failure that appears only under load, which
 * is why it is asserted at the source rather than left to review.
 */
describe("prisma client wiring", () => {
  const code = readCode(join(process.cwd(), "src", "lib", "prisma.ts"));

  it("connects with DATABASE_URL, the pooler connection", () => {
    expect(code).toContain("env.DATABASE_URL");
  });

  it("never reaches for the direct connection", () => {
    expect(code).not.toContain("DIRECT_URL");
  });

  it("caches a single instance across hot reloads in development", () => {
    expect(code).toContain("globalThis");
    expect(code).toMatch(/NODE_ENV !== "production"/);
  });
});
