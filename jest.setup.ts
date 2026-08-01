import "@testing-library/jest-dom";

// Deterministic, obviously-fake configuration for every test run.
//
// These are placeholders, not credentials: a test that needs a real Supabase
// project belongs in the Playwright suite, which reads the actual environment.
// Nothing here may ever hold a real key.
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/sightline_test";
process.env.DIRECT_URL ??=
  "postgresql://postgres:postgres@localhost:5432/sightline_test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.APP_URL ??= "http://localhost:3000";
