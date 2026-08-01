import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `pg` and the Prisma driver adapter are Node-only. Keeping them external
  // stops the bundler trying to trace them into the server bundle.
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],

  experimental: {
    // Enables `forbidden()` and `unauthorized()` from next/navigation, which is
    // what lets an admin route deny IN PLACE at the requested URL with a real
    // 403 rather than redirecting. A redirect would leak that the route exists
    // and is worth redirecting away from.
    authInterrupts: true,
  },

  typescript: {
    // A type error must fail the build. Never set this to true.
    ignoreBuildErrors: false,
  },

  // Next 16 removed the `eslint` config key — lint no longer runs as part of
  // `next build`. Enforcement is the `lint` step in CI, which gates the merge.
  // The colour-literal rule landing in SIG-31 depends on that step, not on the
  // build, so do not move it back here expecting it to be enforced.
};

export default nextConfig;
