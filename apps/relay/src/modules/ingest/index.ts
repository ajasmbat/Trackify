import type { FastifyInstance } from "fastify";

// Ingest module (T4 fills this in).
// Owns: POST /e — validates the CanonicalEvent batch, resolves the tenant,
// persists to `events`, enqueues to `delivery_jobs`.
export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // no-op until T4
}
