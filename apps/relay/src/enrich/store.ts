import type { Pool } from "pg";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";
import { and, eq, sql } from "drizzle-orm";

// The persistence surface the enricher owns on the `visitors` table.
//
// Two entry points, ONE table:
//   - upsertIdentity(): called by ingest inside its transaction when a
//     `user_identified` event lands. Merges the hashed identity block into
//     `visitors.identity` and stamps `identified_at = now()`.
//   - readStoredIdentity(): called by the delivery worker via the pipeline
//     to look up a visitor's stored identity before handing the event to a
//     destination adapter. Enforces TTL as a query filter, never as a
//     background sweep.
//
// The reader deliberately takes a pg.Pool (not a Drizzle Db) because the
// worker already owns its own pool separate from the ingest side and reads
// happen outside any long-lived transaction.

export interface StoredIdentity {
  email_sha256?: string;
  phone_sha256?: string;
  external_id_sha256?: string;
}

/** 180 days — matches Meta's Conversions API attribution window. */
export const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Merge the given hashed identity into `visitors.identity` for this
 * (tenant, visitor_key) pair and stamp `identified_at`. Called from ingest
 * inside the same transaction that upserts the visitor row.
 *
 * Idempotent: re-running with the same identity block is a no-op on the
 * data (the `||` merge is order-preserving and the JSONB is set-not-append).
 */
export async function upsertIdentity(
  tx: Db,
  params: {
    tenantId: string;
    visitorKey: string;
    identity: StoredIdentity;
    now?: Date;
  },
): Promise<void> {
  const identity = filterNonEmpty(params.identity);
  if (!identity) return; // nothing to store — never touch the row

  const now = params.now ?? new Date();
  await tx
    .update(schema.visitors)
    .set({
      // `||` merges the existing JSONB with the incoming block; keys in the
      // right operand win, so a re-hash of the same email is a no-op and a
      // new phone additive.
      identity: sql`${schema.visitors.identity} || ${JSON.stringify(identity)}::jsonb`,
      identifiedAt: now,
    })
    .where(
      and(
        eq(schema.visitors.tenantId, params.tenantId),
        eq(schema.visitors.visitorKey, params.visitorKey),
      ),
    );
}

interface ReadStoredIdentityOptions {
  /** Override the 180-day default (in seconds). */
  ttlSeconds?: number;
  /** Now supplier — pinned in tests. */
  now?: Date;
}

/**
 * Read the stored hashed identity for (tenant, visitor_key), enforcing a
 * TTL cutoff on `identified_at`. Returns null when:
 *   - the visitor row does not exist,
 *   - it exists but was never identified,
 *   - the identity fell outside the TTL,
 *   - the stored identity block is empty (no hashed fields set).
 *
 * The TTL is a WHERE-clause filter, not a background sweep — that keeps
 * expired identity from ever being read, without a cron dependency.
 */
export async function readStoredIdentity(
  pool: Pool,
  params: {
    tenantId: string;
    visitorKey: string;
  },
  opts: ReadStoredIdentityOptions = {},
): Promise<StoredIdentity | null> {
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = opts.now ?? new Date();

  const res = await pool.query<{ identity: StoredIdentity | null }>(
    `SELECT identity
       FROM visitors
      WHERE tenant_id = $1
        AND visitor_key = $2
        AND identified_at IS NOT NULL
        AND identified_at >= ($3::timestamptz - ($4 || ' seconds')::interval)
      LIMIT 1`,
    [params.tenantId, params.visitorKey, now.toISOString(), ttlSeconds],
  );
  const row = res.rows[0];
  if (!row) return null;
  return filterNonEmpty(row.identity ?? {});
}

function filterNonEmpty(id: StoredIdentity): StoredIdentity | null {
  const out: StoredIdentity = {};
  if (id.email_sha256) out.email_sha256 = id.email_sha256;
  if (id.phone_sha256) out.phone_sha256 = id.phone_sha256;
  if (id.external_id_sha256) out.external_id_sha256 = id.external_id_sha256;
  if (!out.email_sha256 && !out.phone_sha256 && !out.external_id_sha256) return null;
  return out;
}
