import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { visitors } from "./visitors";

// One row per canonical event received on POST /e.
// `inbound_payload` — the exact JSON the client sent (post-validation, pre-enrichment).
// `outbound_per_destination` — `{ [destinationId]: outboundPayload }` filled in
// by the delivery worker so hop 6 of the flow contract is verifiable end-to-end.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().unique(), // client-supplied CanonicalEvent.event_id
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    journeyId: text("journey_id").notNull(),
    name: text("name").notNull(), // event name (page_view, purchase, …)
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    inboundPayload: jsonb("inbound_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    outboundPerDestination: jsonb("outbound_per_destination")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTsIdx: index("events_tenant_ts_idx").on(t.tenantId, t.ts),
    journeyIdx: index("events_journey_idx").on(t.journeyId),
  }),
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
