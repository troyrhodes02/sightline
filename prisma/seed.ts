/**
 * Seeds the first admin.
 *
 * **There is no path to the first admin through the product**, and that is
 * structural rather than an oversight: sign-up creates a `pending` row, and
 * only an admin can approve one. The first account therefore has to be created
 * out of band, which is what this script is for.
 *
 * It is idempotent — run it as often as you like. If the account already exists
 * it is repaired to `active` / `admin` rather than duplicated, which makes it a
 * usable "unlock myself" tool as well as a seed.
 *
 * Run:  npm run db:seed
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "troy@sightline.app";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "4023589";
const DISPLAY_NAME = process.env.SEED_ADMIN_NAME ?? "Troy Rhodes";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to seed.`);
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: required("DATABASE_URL") }),
  });

  // The service-role client is the only way to create a confirmed auth user
  // without an email round-trip. Server-side script only; never shipped.
  const auth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Find the auth user first — creating one that already exists errors, and
    // the id has to match the users row either way.
    //
    // Single page, deliberately: this is a bootstrap tool for a product with a
    // handful of accounts. Past 1000 auth users the lookup would miss and the
    // create below would fail on a duplicate email — noisy rather than silent,
    // but worth paginating if that ever becomes plausible.
    const existing = await auth.auth.admin.listUsers({ perPage: 1000 });
    if (existing.error) throw existing.error;

    let authUserId = existing.data.users.find(
      (u) => u.email?.toLowerCase() === EMAIL.toLowerCase(),
    )?.id;

    if (authUserId) {
      // Reset the password so the seed is authoritative about credentials.
      const updated = await auth.auth.admin.updateUserById(authUserId, {
        password: PASSWORD,
        email_confirm: true,
      });
      if (updated.error) throw updated.error;
      console.warn(`Auth user already existed; password reset. (${EMAIL})`);
    } else {
      const created = await auth.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true, // no confirmation flow; approval is the gate
      });
      if (created.error) throw created.error;
      authUserId = created.data.user.id;
      console.warn(`Created auth user. (${EMAIL})`);
    }

    // `users.id` IS the auth UUID — no mapping table, so this must match.
    await prisma.user.upsert({
      where: { id: authUserId },
      create: {
        id: authUserId,
        email: EMAIL.toLowerCase(),
        displayName: DISPLAY_NAME,
        role: "admin",
        status: "active",
        // An approved account needs a decision time; there is no admin above
        // the first one to record as the decider, so it stays null.
        decidedAt: new Date(),
      },
      update: {
        email: EMAIL.toLowerCase(),
        displayName: DISPLAY_NAME,
        role: "admin",
        status: "active",
        decidedAt: new Date(),
        revokedAt: null,
      },
    });

    console.warn(`Seeded admin ${EMAIL} (${authUserId}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
