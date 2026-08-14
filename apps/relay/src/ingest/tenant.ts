import type { FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";

// Local tenant-resolver SEAM. The real hostnames-table lookup is T9's job and
// lives in `apps/relay/src/modules/tenancy/**` — DO NOT edit that folder.
// This module exists only so the ingest handler has a callable seam TODAY:
// tests substitute a mock, and prod calls `stubResolver` which returns the
// first tenant in the DB with a permissive CORS allowlist.

export interface TenantResolution {
  tenantId: string;
  /** Origins allowed by CORS — `["*"]` means allow all. */
  allowedOrigins: string[];
  destinations: Array<{ id: string; provider: string }>;
}

export type TenantResolver = (
  req: FastifyRequest,
) => Promise<TenantResolution | null>;

/**
 * Stub resolver — first tenant + its enabled destinations, permissive CORS.
 * Replaced by T9 with a `Host`-header → hostnames lookup.
 */
export async function stubResolver(
  _req: FastifyRequest,
  client: Db,
): Promise<TenantResolution | null> {
  const [tenant] = await client
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .limit(1);
  if (!tenant) return null;

  const dests = await client
    .select({
      id: schema.destinations.id,
      provider: schema.destinations.provider,
    })
    .from(schema.destinations)
    .where(
      and(
        eq(schema.destinations.tenantId, tenant.id),
        eq(schema.destinations.enabled, true),
      ),
    );

  return {
    tenantId: tenant.id,
    allowedOrigins: ["*"],
    destinations: dests,
  };
}
