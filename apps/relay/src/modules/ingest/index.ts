import type { FastifyInstance } from "fastify";
import { db } from "@trackify/db";
import { registerIngestRoutes } from "../../ingest/route";
import { persistEvent } from "../../ingest/persist";
import { stubResolver } from "../../ingest/tenant";

// Ingest module — owns POST /e. Implementation lives under
// `apps/relay/src/ingest/**` (per the ticket's ownership boundary); this
// module file wires the DB client into the route's ingestion pipeline so
// route.ts itself stays DB-agnostic (and testable without libsodium).
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const client = db();
  await registerIngestRoutes(app, {
    persist: (params) => persistEvent(params, client),
    resolveTenant: (req) => stubResolver(req, client),
  });
}
