import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    // Use forks pool: each test file runs in a real Node.js process using
    // Node's own module resolver.
    pool: "forks",
    // Run test files sequentially — the delivery-worker integration suite
    // uses a shared Postgres and `pg_terminate_backend` against
    // `application_name = ''`, which kills connections owned by any other
    // pg-using suite that happens to run in parallel. Running one file at
    // a time keeps the isolation the tests already assume.
    fileParallelism: false,
    // libsodium-wrappers ships an ESM bundle whose sibling relative import
    // (`./libsodium.mjs`) does not resolve under pnpm's strict layout — the
    // CJS entry, which loads its dep by package name, works everywhere.
    // Force it via a server-side alias so vitest picks the CJS file.
    server: {
      deps: {
        inline: ["libsodium-wrappers"],
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "libsodium-wrappers",
        replacement: here(
          "./node_modules/.pnpm/libsodium-wrappers@0.7.16/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js",
        ),
      },
    ],
  },
});
