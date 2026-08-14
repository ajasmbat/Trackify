import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// One row per stable visitor. Identity fields are merged in as they arrive;
// store the SHA-256 hashes we send to destinations. `fbc` / `fbp` are
// persisted server-side by T12 so subsequent events (once the browser has
// dropped `_fbc`) still carry them into the outbound Meta payload — that
// server-side survival is the whole point of the cookie service.
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
    fbc: text("fbc"),
    fbp: text("fbp"),
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
