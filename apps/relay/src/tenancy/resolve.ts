import { and, eq } from "drizzle-orm";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";
import { decryptCredentials } from "@trackify/db/crypto";

// Tenant resolution — the SOURCE OF TRUTH for who a request is for. Given a
// hostname, join hostnames → tenants → destinations, decrypt each
// destination's credentials, and return the composite. Unknown hostname
// throws a typed `TenantNotFoundError` so the middleware can convert it into a
// 404 rather than a 500. Decrypted credentials MUST NOT leak into JSON output
// or logs — hold them only in the cache entry.

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  allowedOrigins: string[];
}

export interface ResolvedDestination {
  id: string;
  provider: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Decrypted, in-memory only. Never emit this in JSON / logs. */
  credentials: Record<string, string>;
}

export interface TenantContext {
  tenant: TenantRow;
  destinations: ResolvedDestination[];
}

export class TenantNotFoundError extends Error {
  readonly code = "tenant_not_found" as const;
  constructor(public readonly host: string) {
    super(`tenant_not_found: ${host}`);
    this.name = "TenantNotFoundError";
  }
}

export interface ResolveDeps {
  client: Db;
  /** Injectable so tests can substitute a stub without touching libsodium. */
  decrypt?: (b64: string) => Promise<Record<string, string>>;
}

/**
 * Fetch a tenant + its enabled destinations by hostname. Throws
 * `TenantNotFoundError` when no `hostnames` row matches. Only enabled
 * destinations are returned — a disabled destination should never receive
 * traffic even if its row still exists.
 */
export async function resolveTenantByHost(
  host: string,
  deps: ResolveDeps,
): Promise<TenantContext> {
  const decrypt = deps.decrypt ?? decryptCredentials;
  const client = deps.client;

  const [tenantRow] = await client
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      allowedOrigins: schema.tenants.allowedOrigins,
    })
    .from(schema.hostnames)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.hostnames.tenantId))
    .where(eq(schema.hostnames.hostname, host))
    .limit(1);

  if (!tenantRow) throw new TenantNotFoundError(host);

  const destRows = await client
    .select({
      id: schema.destinations.id,
      provider: schema.destinations.provider,
      enabled: schema.destinations.enabled,
      config: schema.destinations.config,
      credentialsEncrypted: schema.destinations.credentialsEncrypted,
    })
    .from(schema.destinations)
    .where(
      and(
        eq(schema.destinations.tenantId, tenantRow.id),
        eq(schema.destinations.enabled, true),
      ),
    );

  const destinations: ResolvedDestination[] = await Promise.all(
    destRows.map(async (row) => ({
      id: row.id,
      provider: row.provider,
      enabled: row.enabled,
      config: row.config,
      credentials: await decrypt(row.credentialsEncrypted),
    })),
  );

  return {
    tenant: {
      id: tenantRow.id,
      slug: tenantRow.slug,
      name: tenantRow.name,
      allowedOrigins: tenantRow.allowedOrigins ?? [],
    },
    destinations,
  };
}

/**
 * Normalize a request `Host` header for cache lookup: strip an explicit port
 * (`example.test:3000` → `example.test`) and lowercase. Empty/undefined input
 * returns `undefined` so the caller can 404 loudly instead of matching an
 * empty hostname row.
 */
export function normalizeHost(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const noPort = raw.split(":", 1)[0];
  if (!noPort) return undefined;
  const trimmed = noPort.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}
