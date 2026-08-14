import type { FastifyInstance } from "fastify";

// Meta destination adapter (T6 fills this in).
// Owns: implements `Destination` for Meta CAPI. Never invents fields —
// mapping lives here and only here.
export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // no-op until T6
}
