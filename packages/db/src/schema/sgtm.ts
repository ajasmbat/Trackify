import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// Per-tenant Google sGTM (server-side Google Tag Manager) container. One
// tenant may host zero or many containers. Rows are created by the T17
// provisioning service and surfaced/edited via the T19 console UI — this
// table is the shared source of truth between them.
//
// `subdomain` is globally unique across tenants: Wave 5 (T18) fronts every
// container from a single apex under one wildcard certificate. The
// `^[a-z0-9-]{3,32}$` shape is enforced at the write path (zod), NOT via a
// Postgres CHECK — cheaper migration story if the rules loosen later.
//
// `status` is plain text validated by `zod.enum` at write sites (same reason:
// no CHECK). Vocabulary: `provisioning | ready | error | stopped`.
//
// `containerState` is an opaque jsonb bag owned by T17 (Docker container id,
// host port, image tag, …). Intentionally no `$type<>` here — this schema
// package must not encode the provisioning implementation's shape.
export const sgtmContainers = pgTable(
  "sgtm_containers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gtmContainerId: text("gtm_container_id").notNull(), // e.g. "GTM-ABCDE12"
    subdomain: text("subdomain").notNull(),
    status: text("status").notNull().default("provisioning"), // provisioning | ready | error | stopped
    containerState: jsonb("container_state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    previewServerUrl: text("preview_server_url"),
    // T21 · Cookie Keeper — when true, the reverse proxy rewrites every
    // Set-Cookie the container emits into a sealed HttpOnly first-party
    // `sgtm_<hash>` cookie and restores the original name/value on inbound
    // requests. Default off; flipping it on invalidates any live cookies
    // set under the previous mode (the browser sees a fresh name).
    cookieKeeperEnabled: boolean("cookie_keeper_enabled")
      .notNull()
      .default(false),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    subdomainIdx: uniqueIndex("sgtm_containers_subdomain_key").on(t.subdomain),
    tenantIdx: index("sgtm_containers_tenant_idx").on(t.tenantId),
  }),
);

export type SgtmContainer = typeof sgtmContainers.$inferSelect;
export type NewSgtmContainer = typeof sgtmContainers.$inferInsert;
