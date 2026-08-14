import type { FastifyInstance } from "fastify";

// Loader module (T8 fills this in).
// Owns: GET /loader.js — the small first-party script the storefront embeds;
// mints a journey_id when the visitor has none and posts events to /e.
export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // no-op until T8
}
