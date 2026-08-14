import type { Pool } from "pg";
import type { CanonicalEvent } from "@trackify/shared";
import { mergeStoredIdentity } from "./identity";
import { readStoredIdentity } from "./store";

// The queue seam. The delivery worker calls `enricher(event)` once per job,
// between reconstruction of the CanonicalEvent from the persisted inbound
// payload and the destination adapter's `send()`.
//
// This is the ONLY place the enricher touches the queue. The enricher has
// no side effects other than the read against `visitors` — the identity
// upsert on `user_identified` happens at ingest (in the same transaction as
// the visitor upsert) so the identity is stored the moment it arrives, not
// on the delivery worker's schedule.

export type Enricher = (event: CanonicalEvent) => Promise<CanonicalEvent>;

export interface CreateEnricherOptions {
  pool: Pool;
  /** Override the 180-day default (in seconds). */
  ttlSeconds?: number;
  /** Now supplier — pinned in tests. */
  now?: () => Date;
}

export function createEnricher(opts: CreateEnricherOptions): Enricher {
  const nowFn = opts.now ?? (() => new Date());
  return async (event) => {
    const stored = await readStoredIdentity(
      opts.pool,
      { tenantId: event.tenant_id, visitorKey: event.visitor_id },
      { ttlSeconds: opts.ttlSeconds, now: nowFn() },
    );
    return mergeStoredIdentity(event, stored);
  };
}

/** Identity enricher — a no-op used when the worker is booted without one
 *  (tests that don't care about enrichment, or a future config that turns
 *  identity carry-forward off). */
export const passthroughEnricher: Enricher = (event) => Promise.resolve(event);
