import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

/**
 * Authored as .mjs rather than .ts so Jest needs no ts-node to read its own
 * config — one fewer dependency for a file that changes twice a year.
 *
 * @type {import('jest').Config}
 */
const config = {
  clearMocks: true,
  coverageProvider: "v8",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },

  // Node by default, because most of what this application does is server-side.
  // Component tests opt into jsdom with a `@jest-environment jsdom` docblock —
  // which also keeps `typeof window` honest for the server-only guard in
  // `src/env.ts`, whose whole job is to throw when a browser is present.
  testEnvironment: "node",

  // Playwright owns `e2e/`. Running those under Jest fails on `test.describe`
  // with an error that explains nothing.
  // `prisma/tests` runs under node:test via `npm run test:schema`, not Jest.
  testPathIgnorePatterns: [
    "<rootDir>/e2e/",
    "<rootDir>/.next/",
    "<rootDir>/prisma/",
  ],
};

export default createJestConfig(config);
