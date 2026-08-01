import { parseClientEnv, parseServerEnv, type EnvSource } from "@/env";

const VALID_SERVER = {
  DATABASE_URL: "postgresql://u:p@host:6543/db?pgbouncer=true",
  DIRECT_URL: "postgresql://u:p@host:5432/db",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  APP_URL: "https://sightline.example",
  NODE_ENV: "test",
} satisfies EnvSource;

const VALID_CLIENT = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
} satisfies EnvSource;

describe("environment configuration", () => {
  it("accepts a complete server environment", () => {
    const env = parseServerEnv(VALID_SERVER);
    expect(env.DATABASE_URL).toContain("6543");
    expect(env.DIRECT_URL).toContain("5432");
  });

  // AC: "Missing environment variables fail at startup with a named error."
  it.each([
    "DATABASE_URL",
    "DIRECT_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APP_URL",
  ])("fails by name when %s is missing", (key) => {
    const source: EnvSource = { ...VALID_SERVER };
    delete source[key];

    expect(() => parseServerEnv(source)).toThrow(key);
  });

  it("rejects a non-absolute APP_URL", () => {
    expect(() =>
      parseServerEnv({ ...VALID_SERVER, APP_URL: "/invite" }),
    ).toThrow("APP_URL");
  });

  it("accepts a complete client environment", () => {
    const env = parseClientEnv(VALID_CLIENT);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://project.supabase.co");
  });

  it("fails by name when a public variable is missing", () => {
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  // No Kalshi variable exists until Pitch 11. This asserts the absence, because
  // "there is nothing to misconfigure yet" is only true while it stays true.
  it("defines no Kalshi credential variable", () => {
    const parsed = parseServerEnv(VALID_SERVER) as Record<string, unknown>;
    const keys = Object.keys(parsed).join(" ").toLowerCase();

    expect(keys).not.toContain("kalshi");
    expect(keys).not.toContain("signing");
    expect(keys).not.toContain("private_key");
  });
});
