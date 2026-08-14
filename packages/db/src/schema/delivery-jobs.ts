import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { destinations } from "./destinations";
import { events } from "./events";

// The queue. One row per (event, destination) delivery attempt series.
// Postgres-backed by design — no Redis. `outbound_payload` mirrors what the
// destination adapter actually sent, filled in on the first send and updated
// on retries; a copy is also written back onto `events.outbound_per_destination`.
//
// Status transitions: pending → in_flight → { done | failed | retrying }.
// `attempts` + `next_attempt_at` drive the exponential-backoff scheduler.
export const deliveryJobs = pgTable(
  "delivery_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => destinations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | in_flight | done | failed | retrying
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    inboundPayload: jsonb("inbound_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    outboundPayload: jsonb("outbound_payload").$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    dueIdx: index("delivery_jobs_due_idx").on(t.status, t.nextAttemptAt),
    tenantIdx: index("delivery_jobs_tenant_idx").on(t.tenantId),
  }),
);

export type DeliveryJob = typeof deliveryJobs.$inferSelect;
export type NewDeliveryJob = typeof deliveryJobs.$inferInsert;
