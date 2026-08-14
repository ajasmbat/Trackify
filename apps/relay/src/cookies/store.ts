import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";

// visitors.fbc / visitors.fbp persistence. This is the whole point of the
// cookie service: browsers strip the JS-visible `_fbc` cookie under ITP /
// long enough between clicks, so we mirror it into a Postgres row on first
// sight and let the enricher (T13) pull it back onto later events that no
// longer carry a client `_fbc`.
//
// Kept as a thin functional module (no class) so the wiring layer can inject
// the drizzle client without a construction step; matches T4's persist.ts.

export interface UpsertVisitorFbcParams {
  tenantId: string;
  /** Client-supplied identifier — matches T4's `event.visitor_id` so the
   *  visitor row already inserted by ingest is the one we update. */
  visitorKey: string;
  fbc?: string;
  fbp?: string;
}

/**
 * Upsert (fbc, fbp) onto the visitor row keyed by (tenantId, visitorKey).
 * A no-op when both values are missing — we never want to touch the row
 * (or bump last_seen_at) just because the hook fired. `fbc`/`fbp` are
 * only overwritten with a non-empty new value; passing `undefined` keeps
 * whatever we had before.
 */
export async function upsertVisitorFbc(
  params: UpsertVisitorFbcParams,
  client: Db,
): Promise<void> {
  const fbc = params.fbc?.trim();
  const fbp = params.fbp?.trim();
  if (!fbc && !fbp) return;

  await client
    .insert(schema.visitors)
    .values({
      tenantId: params.tenantId,
      visitorKey: params.visitorKey,
      fbc: fbc ?? null,
      fbp: fbp ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.visitors.tenantId, schema.visitors.visitorKey],
      // COALESCE the excluded value so a later request that only supplies
      // fbp does not blank out a previously-stored fbc.
      set: {
        fbc: fbc ? sql`excluded.fbc` : sql`${schema.visitors.fbc}`,
        fbp: fbp ? sql`excluded.fbp` : sql`${schema.visitors.fbp}`,
        lastSeenAt: sql`now()`,
      },
    });
}

export interface VisitorFbcRow {
  fbc: string | null;
  fbp: string | null;
}

/**
 * Read the persisted (fbc, fbp) for a given visitor. Returns `null` when the
 * visitor row does not exist yet — the caller (T13's enricher) treats that
 * as "nothing to enrich". Never throws on a missing row.
 */
export async function readVisitorFbc(
  params: { tenantId: string; visitorKey: string },
  client: Db,
): Promise<VisitorFbcRow | null> {
  const [row] = await client
    .select({ fbc: schema.visitors.fbc, fbp: schema.visitors.fbp })
    .from(schema.visitors)
    .where(
      and(
        eq(schema.visitors.tenantId, params.tenantId),
        eq(schema.visitors.visitorKey, params.visitorKey),
      ),
    )
    .limit(1);
  return row ?? null;
}
