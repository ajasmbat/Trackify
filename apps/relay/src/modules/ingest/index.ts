import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "@trackify/db";
import { registerIngestRoutes } from "../../ingest/route";
import { persistEvent } from "../../ingest/persist";
import type { TenantResolver, TenantResolution } from "../../ingest/tenant";

// Ingest module — owns POST /e. Implementation lives under
// `apps/relay/src/ingest/**` (per T4's ownership boundary); this module file
// wires the DB client into the route's ingestion pipeline so route.ts itself
// stays DB-agnostic (and testable without libsodium).
//
// The tenant resolver is adapted from T9's tenancy hook: by the time the
// ingest handler runs, `req.tenant` is already populated (or the request was
// short-circuited with a 404). We just map it into the shape T4 expects and
// deliberately drop decrypted credentials at the seam — the ingest handler
// never sees them.
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const client = db();
  await registerIngestRoutes(app, {
    persist: (params) => persistEvent(params, client),
    resolveTenant: tenantAdapter,
  });
}

const tenantAdapter: TenantResolver = async (
  req: FastifyRequest,
): Promise<TenantResolution | null> => {
  const ctx = req.tenant;
  if (!ctx) return null;
  return {
    tenantId: ctx.tenant.id,
    allowedOrigins: ctx.tenant.allowedOrigins,
    destinations: ctx.destinations.map((d) => ({
      id: d.id,
      provider: d.provider,
    })),
  };
};
