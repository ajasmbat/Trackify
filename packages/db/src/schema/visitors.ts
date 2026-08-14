import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// One row per stable visitor (first-party cookie in T7). Identity fields are
// merged in as they arrive; store the SHA-256 hashes we send to destinations.
export const visitors = pgTable(
  "visitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    visitorKey: text("visitor_key").notNull(), // stable across sessions (cookie value)
    identity: jsonb("identity")
      .$type<{
        email_sha256?: string;
        phone_sha256?: string;
        external_id_sha256?: string;
      }>()
      .notNull()
      .default({}),
    // Set the first time a `user_identified` event lands hashed identity onto
    // this visitor; refreshed on every subsequent user_identified. The
    // enricher (T13) uses this as the TTL anchor — an identity older than the
    // configured window is treated as unknown.
    identifiedAt: timestamp("identified_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantVisitorKey: uniqueIndex("visitors_tenant_key_idx").on(
      t.tenantId,
      t.visitorKey,
    ),
  }),
);

export type Visitor = typeof visitors.$inferSelect;
export type NewVisitor = typeof visitors.$inferInsert;
