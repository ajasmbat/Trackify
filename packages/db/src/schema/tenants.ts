import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Exact-match CORS allowlist. Wildcards are intentionally not supported.
  allowedOrigins: text("allowed_origins")
    .array()
    .notNull()
    .default([]),
  // Randomised per-tenant path for the T11 tracking snippet. Generated once
  // on provisioning (min 40 bits of entropy, URL-safe alphabet); rotating it
  // is a manual operator action because it breaks cached storefront script
  // tags. Unique so a leaked path can't collide when re-issued.
  loaderPath: text("loader_path").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
