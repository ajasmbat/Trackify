import { eq } from "drizzle-orm";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";
import type { CanonicalEvent } from "@trackify/shared";
import { upsertIdentity } from "../enrich/store";
import type { HashedIdentity } from "./hash";

// Transactional persistence for a single event. On the happy path we write
// one `events` row and one `delivery_jobs` row per configured destination in
// a SINGLE transaction — if the enqueue step throws, the event row is not
// left orphaned.

export interface PersistParams {
  tenantId: string;
  destinationIds: string[];
  /** The client-supplied event with raw PII already stripped from `identity`. */
  event: CanonicalEvent;
  /** Hashed identity written back onto the persisted payload. */
  identity: HashedIdentity | undefined;
  /** Server-derived sidecar (headers, fbc, receive time). */
  server: {
    client_ip_address?: string;
    client_user_agent?: string;
    fbc?: string;
    fbclid?: string;
    received_at: string; // ISO
  };
}

export interface PersistResult {
  /** Row id from `events` — the client's event_id is echoed separately. */
  eventRowId: string;
  eventId: string;
  /** True when a row with this event_id already existed (idempotency). */
  duplicate: boolean;
}

/**
 * Insert a visitor (if new), the event, and one delivery_jobs row per
 * destination — all inside one transaction. Returns the events.id.
 */
export async function persistEvent(
  params: PersistParams,
  client: Db,
): Promise<PersistResult> {
  return client.transaction(async (tx) => {
    // Upsert the visitor keyed on (tenant, visitor_key). We keep `first_seen_at`
    // untouched on conflict and just refresh `last_seen_at`.
    const [visitor] = await tx
      .insert(schema.visitors)
      .values({
        tenantId: params.tenantId,
        visitorKey: params.event.visitor_id,
      })
      .onConflictDoUpdate({
        target: [schema.visitors.tenantId, schema.visitors.visitorKey],
        set: { lastSeenAt: new Date() },
      })
      .returning({ id: schema.visitors.id });
    if (!visitor) throw new Error("visitor upsert returned no row");

    // On `user_identified`, merge the hashed identity block onto the
    // visitor row so subsequent (anonymous) events can be enriched by the
    // delivery worker (T13). Done in-transaction so the identity is either
    // committed with the event or not at all.
    if (params.event.name === "user_identified" && params.identity) {
      await upsertIdentity(tx, {
        tenantId: params.tenantId,
        visitorKey: params.event.visitor_id,
        identity: params.identity,
      });
    }

    // Build the persisted payload: the validated client event with raw PII
    // stripped from `identity`, plus a server-side sidecar under `server`.
    const inboundPayload = {
      ...params.event,
      identity: params.identity,
      server: params.server,
    };

    // `event_id` is globally unique — a retry (same event_id) MUST NOT create
    // a duplicate row or a duplicate delivery job. onConflictDoNothing skips
    // the insert; we then re-fetch the existing row's id.
    const inserted = await tx
      .insert(schema.events)
      .values({
        eventId: params.event.event_id,
        tenantId: params.tenantId,
        visitorId: visitor.id,
        journeyId: params.event.journey_id,
        name: params.event.name,
        ts: new Date(params.event.ts),
        inboundPayload,
      })
      .onConflictDoNothing({ target: schema.events.eventId })
      .returning({ id: schema.events.id });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(eq(schema.events.eventId, params.event.event_id));
      if (!existing) throw new Error("duplicate detected but row missing");
      return {
        eventRowId: existing.id,
        eventId: params.event.event_id,
        duplicate: true,
      };
    }

    const eventRow = inserted[0];
    if (!eventRow) throw new Error("event insert returned no row");

    if (params.destinationIds.length > 0) {
      await tx.insert(schema.deliveryJobs).values(
        params.destinationIds.map((destinationId) => ({
          tenantId: params.tenantId,
          eventId: eventRow.id,
          destinationId,
          inboundPayload,
        })),
      );
    }

    return {
      eventRowId: eventRow.id,
      eventId: params.event.event_id,
      duplicate: false,
    };
  });
}
