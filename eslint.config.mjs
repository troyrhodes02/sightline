import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * `eslint-config-next` v16 exports flat config arrays directly, so it is spread
 * rather than wrapped in FlatCompat.
 */

/**
 * The service-role key bypasses every Supabase-side check, so exactly one
 * module may hold it. `server-only` catches a client import; this catches a
 * *server* module reaching for it without cause.
 *
 * Repeated in each override below because flat config replaces a rule's options
 * wholesale rather than merging them — dropping it from one block would quietly
 * unrestrict that file set.
 */
const restrictAdminClient = {
  group: ["**/supabase/admin", "@/lib/supabase/admin"],
  message:
    "The service-role client is restricted. Only invitation acceptance (SIG-34) and revocation (SIG-36) may import it, and each must add itself to the exemption in eslint.config.mjs with a reason.",
};

const config = [
  {
    ignores: [
      ".next/**",
      "generated/**",
      "node_modules/**",
      "python/**",
      "prisma/tests/**",
      "docs/**",
      "design/**",
      "public/**",
      // Local `supabase start` state — gitignored, and not ours to lint.
      // Flat config does not read .gitignore, so it must be named here.
      "supabase/**",
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // An error, not a warning. A warning in a repo whose build ignores
      // warnings is a comment.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [restrictAdminClient] }],
    },
  },

  {
    // Client components additionally must not reach for Prisma.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [restrictAdminClient],
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Prisma is server-side only. Read through a server component or a route handler.",
            },
          ],
        },
      ],
    },
  },

  {
    // The module that defines the client is naturally exempt from the rule
    // forbidding its import.
    files: ["src/lib/supabase/admin.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  {
    // Structural tests read the source tree and assert on paths and imports.
    files: ["src/**/*.test.ts", "src/lib/testing/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
