import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@trackify/db/schema";
import { db, pool } from "./db";

// Every SELECT the console runs. We NEVER select
// `destinations.credentials_encrypted` — a read-only DB role in prod would
// refuse anyway, but the column allowlist here means a misconfigured dev DB
// doesn't leak the ciphertext either.

export type EventStatus =
  | "pending"
  | "in_flight"
  | "retrying"
  | "done"
  | "dead_letter";

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
}

export async function listTenants(): Promise<TenantSummary[]> {
  return db()
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
    })
    .from(schema.tenants)
    .orderBy(schema.tenants.name);
}

export async function getTenantBySlug(
  slug: string,
): Promise<TenantSummary | null> {
  const [row] = await db()
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);
  return row ?? null;
}

export interface DestinationSummary {
  id: string;
  provider: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export async function listDestinations(
  tenantId: string,
): Promise<DestinationSummary[]> {
  return db()
    .select({
      id: schema.destinations.id,
      provider: schema.destinations.provider,
      enabled: schema.destinations.enabled,
      config: schema.destinations.config,
    })
    .from(schema.destinations)
    .where(eq(schema.destinations.tenantId, tenantId))
    .orderBy(schema.destinations.provider);
}

// One row in the events list — the *aggregate* delivery status across all
// destinations for this event, computed by rolling up delivery_jobs.status
// (dead_letter > retrying/in_flight > pending > all done).
export interface EventListRow {
  id: string;
  eventId: string;
  tenantId: string;
  journeyId: string;
  name: string;
  ts: Date;
  receivedAt: Date;
  status: EventStatus;
}

export interface ListEventsFilter {
  tenantId: string;
  name?: string;
  status?: EventStatus;
  sinceReceivedAt?: Date; // events with received_at > this (live tail cursor)
  fromTs?: Date;
  untilTs?: Date;
  limit?: number;
}

// Aggregate status expression — dead_letter > retrying/in_flight > pending >
// all-done. Emitted once, referenced twice (SELECT and HAVING) so the two
// stay in sync.
const STATUS_CASE_SQL = `(CASE
    WHEN bool_or(dj.status = 'dead_letter') THEN 'dead_letter'
    WHEN bool_or(dj.status IN ('retrying', 'in_flight')) THEN 'retrying'
    WHEN bool_or(dj.status = 'pending') THEN 'pending'
    WHEN bool_and(dj.status = 'done') THEN 'done'
    ELSE 'pending'
  END)`;

export async function listEvents(
  filter: ListEventsFilter,
): Promise<EventListRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  const where: string[] = [`e.tenant_id = ${bind(filter.tenantId)}`];
  if (filter.name) where.push(`e.name = ${bind(filter.name)}`);
  if (filter.fromTs) where.push(`e.ts >= ${bind(filter.fromTs)}`);
  if (filter.untilTs) where.push(`e.ts <= ${bind(filter.untilTs)}`);
  if (filter.sinceReceivedAt) {
    where.push(`e.received_at > ${bind(filter.sinceReceivedAt)}`);
  }

  const having = filter.status
    ? `HAVING ${STATUS_CASE_SQL} = ${bind(filter.status)}`
    : "";

  const q = `
    SELECT e.id                                   AS id,
           e.event_id                             AS "eventId",
           e.tenant_id                            AS "tenantId",
           e.journey_id                           AS "journeyId",
           e.name                                 AS name,
           e.ts                                   AS ts,
           e.received_at                          AS "receivedAt",
           ${STATUS_CASE_SQL}                     AS status
      FROM events e
      LEFT JOIN delivery_jobs dj ON dj.event_id = e.id
     WHERE ${where.join(" AND ")}
     GROUP BY e.id
     ${having}
     ORDER BY e.received_at DESC
     LIMIT ${bind(limit)}
  `;

  const res = await pool().query<EventListRow>(q, params);
  return res.rows.map((r) => ({
    ...r,
    ts: new Date(r.ts as unknown as string),
    receivedAt: new Date(r.receivedAt as unknown as string),
  }));
}

export interface EventDetail {
  id: string;
  eventId: string;
  tenantId: string;
  visitorId: string;
  journeyId: string;
  name: string;
  ts: Date;
  receivedAt: Date;
  inboundPayload: Record<string, unknown>;
  outboundPerDestination: Record<string, unknown>;
  deliveries: DeliveryJobRow[];
}

export interface DeliveryJobRow {
  id: string;
  destinationId: string;
  destinationProvider: string;
  status: string;
  attempts: number;
  lastError: string | null;
  outboundPayload: unknown;
  createdAt: Date;
  nextAttemptAt: Date;
  completedAt: Date | null;
}

async function fetchDeliveries(
  eventRowIds: string[],
): Promise<Map<string, DeliveryJobRow[]>> {
  const byEvent = new Map<string, DeliveryJobRow[]>();
  if (eventRowIds.length === 0) return byEvent;
  const rows = await db()
    .select({
      eventId: schema.deliveryJobs.eventId,
      id: schema.deliveryJobs.id,
      destinationId: schema.deliveryJobs.destinationId,
      destinationProvider: schema.destinations.provider,
      status: schema.deliveryJobs.status,
      attempts: schema.deliveryJobs.attempts,
      lastError: schema.deliveryJobs.lastError,
      outboundPayload: schema.deliveryJobs.outboundPayload,
      createdAt: schema.deliveryJobs.createdAt,
      nextAttemptAt: schema.deliveryJobs.nextAttemptAt,
      completedAt: schema.deliveryJobs.completedAt,
    })
    .from(schema.deliveryJobs)
    .leftJoin(
      schema.destinations,
      eq(schema.destinations.id, schema.deliveryJobs.destinationId),
    )
    .where(inArray(schema.deliveryJobs.eventId, eventRowIds))
    .orderBy(schema.deliveryJobs.createdAt);
  for (const r of rows) {
    const list = byEvent.get(r.eventId) ?? [];
    list.push({
      id: r.id,
      destinationId: r.destinationId,
      destinationProvider: r.destinationProvider ?? "unknown",
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      outboundPayload: r.outboundPayload,
      createdAt: r.createdAt,
      nextAttemptAt: r.nextAttemptAt,
      completedAt: r.completedAt,
    });
    byEvent.set(r.eventId, list);
  }
  return byEvent;
}

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const [event] = await db()
    .select({
      id: schema.events.id,
      eventId: schema.events.eventId,
      tenantId: schema.events.tenantId,
      visitorId: schema.events.visitorId,
      journeyId: schema.events.journeyId,
      name: schema.events.name,
      ts: schema.events.ts,
      receivedAt: schema.events.receivedAt,
      inboundPayload: schema.events.inboundPayload,
      outboundPerDestination: schema.events.outboundPerDestination,
    })
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .limit(1);
  if (!event) return null;
  const deliveries = await fetchDeliveries([event.id]);
  return { ...event, deliveries: deliveries.get(event.id) ?? [] };
}

// Ordered event list for a journey_id, scoped to a tenant (journey_id is
// per-tenant since ingest mints it server-side).
export async function listJourneyEvents(
  tenantId: string,
  journeyId: string,
): Promise<EventDetail[]> {
  const rows = await db()
    .select({
      id: schema.events.id,
      eventId: schema.events.eventId,
      tenantId: schema.events.tenantId,
      visitorId: schema.events.visitorId,
      journeyId: schema.events.journeyId,
      name: schema.events.name,
      ts: schema.events.ts,
      receivedAt: schema.events.receivedAt,
      inboundPayload: schema.events.inboundPayload,
      outboundPerDestination: schema.events.outboundPerDestination,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.journeyId, journeyId),
      ),
    )
    .orderBy(schema.events.ts);
  if (rows.length === 0) return [];
  const deliveries = await fetchDeliveries(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, deliveries: deliveries.get(r.id) ?? [] }));
}
