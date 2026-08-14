import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "@trackify/db";
import { env } from "../../env";
import { registerLoaderRoutes, type LoaderTenant } from "../../loader/route";

// Loader module (T11). Owns: `GET /l/:path.js` — the per-tenant, path-obscured
// tracking snippet served from the relay's own domain. Not from the storefront
// bundle. See DECISIONS.md for the ad-blocker-resistance rationale.
//
// Route registration is exempted from the Host-based tenancy hook because the
// tenant is identified by the URL path, not the Host header. The DB lookup
// here validates that path before returning any bytes.
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const client = db();
  await registerLoaderRoutes(app, {
    resolveByLoaderPath: (path) => resolveLoaderPath(client, path),
    relayOrigin: env.RELAY_URL,
  });
}

async function resolveLoaderPath(
  client: ReturnType<typeof db>,
  path: string,
): Promise<LoaderTenant | null> {
  const [row] = await client
    .select({
      id: schema.tenants.id,
      loaderPath: schema.tenants.loaderPath,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.loaderPath, path))
    .limit(1);
  return row ?? null;
}
