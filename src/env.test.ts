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
  it.each(["DATABASE_URL", "DIRECT_URL", "SUPABASE_SERVICE_ROLE_KEY"])(
    "fails by name when %s is missing",
    (key) => {
      const source: EnvSource = { ...VALID_SERVER };
      delete source[key];

      expect(() => parseServerEnv(source)).toThrow(key);
    },
  );

  // Optional, because nothing reads it. A deployment must not fail to boot over
  // a variable no code touches.
  it("boots without APP_URL", () => {
    const source: EnvSource = { ...VALID_SERVER };
    delete source.APP_URL;

    expect(() => parseServerEnv(source)).not.toThrow();
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

  // Pitch 4 introduced the OPTIONAL market-data key pair (spec RD-18). The
  // boundary this suite used to assert ("no Kalshi variable exists") moved
  // with the pitch; what must stay true now is that the pair is optional —
  // market-data reads work unauthenticated — and server-side only.
  it("boots without any Kalshi credential configured", () => {
    const parsed = parseServerEnv(VALID_SERVER);
    expect(parsed.KALSHI_API_KEY_ID).toBeUndefined();
    expect(parsed.KALSHI_PRIVATE_KEY_PEM).toBeUndefined();
    expect(parsed.KALSHI_API_BASE_URL).toContain("https://");
  });

  it("never exposes a Kalshi value through the client schema", () => {
    const client = parseClientEnv(VALID_CLIENT) as Record<string, unknown>;
    expect(Object.keys(client).join(" ").toLowerCase()).not.toContain("kalshi");
  });

  it("applies the documented sync and threshold defaults", () => {
    const parsed = parseServerEnv(VALID_SERVER);
    expect(parsed.KALSHI_SYNC_MIN_INTERVAL_SECONDS).toBe(30);
    expect(parsed.PRICE_HEARTBEAT_MINUTES).toBe(15);
    expect(parsed.RECOMMENDATION_THRESHOLD_POINTS).toBe(5);
  });
});
