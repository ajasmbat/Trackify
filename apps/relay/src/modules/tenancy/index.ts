import type { FastifyInstance } from "fastify";

// Tenancy module (T4 wires this in).
// Owns: resolving an incoming request's `Host` header (or an override header
// in dev) to a tenant via the `hostnames` table.
export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // no-op until T4
}
