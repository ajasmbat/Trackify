import type { FastifyInstance } from "fastify";
import { db } from "@trackify/db";
import { installTenancyFromDb } from "../../tenancy/middleware";

// Wire the tenancy hook onto the app. Runs an `onRequest` hook that resolves
// the tenant from the `Host` header (cached with a short TTL), applies
// per-tenant exact-origin CORS to the reply, short-circuits OPTIONS
// preflights with 204, and 404s any unknown host. Other modules pick up the
// resolved tenant off `req.tenant`.
//
// Must register BEFORE any module that expects a tenant on the request
// (currently the ingest module). The registration order lives in ../index.ts.
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await installTenancyFromDb(app, { client: db() });
}
