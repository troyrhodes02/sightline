import { readFileSync } from "node:fs";
import { join } from "node:path";
import { productionFiles, readCode } from "@/lib/testing/source";

/**
 * Structural guard on the service-role credential.
 *
 * The ESLint rule in `eslint.config.mjs` is the primary mechanism; this test is
 * the one that survives someone adding an `eslint-disable`. It asserts by
 * reading the source tree rather than by mocking, because the property being
 * protected is "no module reaches for this", not "this function behaves".
 */

const SRC = join(process.cwd(), "src");
const ADMIN_MODULE = join(SRC, "lib", "supabase", "admin.ts");

describe("service-role client isolation", () => {
  const files = productionFiles(SRC).filter((f) => f !== ADMIN_MODULE);

  it("is marked server-only, so a client import is a build error", () => {
    expect(readFileSync(ADMIN_MODULE, "utf8")).toMatch(
      /^import "server-only";/m,
    );
  });

  it("is the only module reading the service-role key", () => {
    // `src/env.ts` declares the variable in its schema, which is not a read.
    const declaring = join(SRC, "env.ts");

    const offenders = files.filter(
      (file) =>
        file !== declaring &&
        readCode(file).includes("SUPABASE_SERVICE_ROLE_KEY"),
    );

    expect(offenders).toEqual([]);
  });

  it("is imported only by the sanctioned call sites", () => {
    // Each entry is a deliberate edit, so the credential's reach is reviewed
    // rather than allowed to drift. These two are the complete set for the
    // milestone; a third appearing here is a review-blocking finding.
    const allowed = [
      // Creates the Supabase auth user during invitation acceptance — the only
      // path that creates an account at all.
      join(SRC, "app", "api", "invitations", "accept", "route.ts"),
      // Invalidates refresh tokens on revocation. Best-effort: the database
      // write is the authoritative gate.
      join(SRC, "app", "api", "users", "[id]", "revoke", "route.ts"),
    ];

    const importers = files.filter((file) =>
      /from\s+["'](?:@\/lib\/supabase\/admin|[.\/]*supabase\/admin)["']/.test(
        readCode(file),
      ),
    );

    expect(importers).toEqual(allowed);
  });
});
