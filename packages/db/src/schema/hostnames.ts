import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// A hostname resolves an incoming request to a tenant. One tenant → many
// hostnames (apex + www + preview subdomains).
export const hostnames = pgTable(
  "hostnames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    hostnameIdx: uniqueIndex("hostnames_hostname_key").on(t.hostname),
  }),
);

export type Hostname = typeof hostnames.$inferSelect;
export type NewHostname = typeof hostnames.$inferInsert;
