import type { FastifyInstance } from "fastify";

// Enrichment module (later ticket).
// Owns: server-side enrichment of inbound events (IP → country, UA → device),
// applied after ingest validation and before persistence.
export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // no-op until enrichment ticket
}
