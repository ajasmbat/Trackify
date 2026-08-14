import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// One row per (tenant, provider). `credentials_encrypted` is
// base64(nonce||ciphertext) from `@trackify/db/crypto`. Never store plaintext.
// `config` holds non-secret provider settings (pixel ids, dataset ids, etc).
export const destinations = pgTable("destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "meta", "ga4", …
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Destination = typeof destinations.$inferSelect;
export type NewDestination = typeof destinations.$inferInsert;
