import type { FastifyInstance } from "fastify";

// Queue module (T5 fills this in).
// Owns: the Postgres-backed delivery worker loop that pulls from
// `delivery_jobs` and dispatches to destination adapters.
export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // no-op until T5
}
