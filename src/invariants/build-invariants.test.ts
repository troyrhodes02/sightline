import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { productionFiles, readCode, sourceFiles } from "@/lib/testing/source";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * Milestone-wide invariants.
 *
 * Each is a property of the whole codebase rather than of any one module, so
 * none of them belongs to the PR that happened to introduce the risk. They fail
 * the build via the CI `test` step.
 */

describe("styling", () => {
  it("has exactly one styling system", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const installed = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });

    const banned = [
      "tailwindcss",
      "styled-components",
      "@chakra-ui/react",
      "antd",
      "bootstrap",
      "@radix-ui/themes",
      "sass",
      "less",
    ];

    expect(installed.filter((dep) => banned.includes(dep))).toEqual([]);
  });

  it("has no hand-authored stylesheet", () => {
    const stylesheets = sourceFiles(SRC)
      .concat(
        readdirSync(SRC, { recursive: true, encoding: "utf8" })
          .filter((f) => /\.(css|scss|sass|less)$/.test(f))
          .map((f) => join(SRC, f)),
      )
      .filter((f) => /\.(css|scss|sass|less)$/.test(f));

    expect(stylesheets).toEqual([]);
  });

  it("confines colour literals to the theme, the lockup, and the email", () => {
    const exempt = new Set([
      join(SRC, "theme", "index.ts"),
      join(SRC, "components", "brand", "SightlineLockup.tsx"),
    ]);

    const offenders = productionFiles(SRC)
      .filter((file) => !exempt.has(file))
      .filter((file) =>
        /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(readCode(file)),
      );

    expect(offenders).toEqual([]);
  });
});

describe("authorization", () => {
  it("derives no role from a token claim anywhere", () => {
    const offenders = productionFiles(SRC).filter((file) => {
      const code = readCode(file);
      return /app_metadata|user_metadata|claims?\.role/i.test(code);
    });

    expect(offenders).toEqual([]);
  });

  it("renders no authenticated route statically", () => {
    // requireSession re-reads users.status per request. A cached authenticated
    // page serves a revoked user their old shell and undoes the mechanism.
    const authenticated = sourceFiles(join(SRC, "app", "(app)")).filter((f) =>
      /[\/\\](page|layout)\.tsx$/.test(f),
    );

    expect(authenticated.length).toBeGreaterThan(0);
    for (const file of authenticated) {
      expect(readCode(file)).toContain('dynamic = "force-dynamic"');
    }
  });

  it("guards every admin route", () => {
    const adminRoutes = [
      join(SRC, "app", "(app)", "health", "page.tsx"),
      join(SRC, "app", "(app)", "users", "page.tsx"),
      join(SRC, "app", "api", "users", "[id]", "decision", "route.ts"),
    ];

    for (const route of adminRoutes) {
      expect(readCode(route)).toContain("requireAdmin()");
    }
  });
});

describe("credentials", () => {
  it("has no field anywhere that could hold a Kalshi credential", () => {
    // Pitch 11 introduces the signing key. The rule that nothing accepts one is
    // established before there is one to leak.
    //
    // Matches credential-shaped identifiers, not the word "Kalshi" — the slate
    // placeholder says "arrive with Kalshi market sync", which is product copy
    // and must stay allowed.
    const credentialShaped =
      /signingKey|signing_key|privateKey|private_key|rsaKey|rsa_key|apiSecret|api_secret|KALSHI_[A-Z_]*KEY/;

    const offenders = productionFiles(SRC).filter((file) =>
      credentialShaped.test(readCode(file)),
    );

    expect(offenders).toEqual([]);
  });

  it("reads the service-role key in exactly one module", () => {
    const readers = productionFiles(SRC).filter(
      (file) =>
        file !== join(SRC, "env.ts") &&
        readCode(file).includes("SUPABASE_SERVICE_ROLE_KEY"),
    );

    expect(readers).toEqual([join(SRC, "lib", "supabase", "admin.ts")]);
  });
});

describe("product boundaries", () => {
  it("exposes no route the product has ruled out", () => {
    const routes = sourceFiles(join(SRC, "app")).map((f) =>
      f.replace(SRC, "").split(sep).join("/"),
    );

    // `/sign-up` IS a route now — account requests are how people get in.
    // What stays forbidden is anything that would grant access without an
    // admin decision, or that belongs to a later pitch.
    for (const forbidden of [
      "/reset-password",
      "/forgot-password",
      "/bankroll",
      "/picks",
      "/subscriptions",
      "/nba",
      "/wnba",
      "/messages",
    ]) {
      expect(routes.filter((r) => r.includes(forbidden))).toEqual([]);
    }
  });
});
