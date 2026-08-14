import { z } from "zod";

// Transport-level shared shapes only. NEVER add fields specific to any
// destination (Meta, GA4, …) — those live in the destination adapter.

export const EVENT_NAMES = [
  "page_view",
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "user_identified",
  "purchase",
] as const;

export const EventName = z.enum(EVENT_NAMES);
export type EventName = z.infer<typeof EventName>;

// Identity fields flow as an optional block. All values are already
// normalised (see pii.normalise*) and, when the caller intends to send to
// destinations that require hashing, already SHA-256'd (see pii.sha256Hex).
export const Identity = z
  .object({
    email: z.string().optional(),
    email_sha256: z.string().length(64).optional(),
    phone: z.string().optional(),
    phone_sha256: z.string().length(64).optional(),
    external_id: z.string().optional(),
    external_id_sha256: z.string().length(64).optional(),
  })
  .strict();
export type Identity = z.infer<typeof Identity>;

// A single product line item — used by view_item, add_to_cart, purchase.
export const LineItem = z
  .object({
    sku: z.string(),
    name: z.string().optional(),
    quantity: z.number().int().positive().default(1),
    price_cents: z.number().int().nonnegative(),
    currency: z.string().length(3),
  })
  .strict();
export type LineItem = z.infer<typeof LineItem>;

// Shared client-context envelope. Kept small on purpose — anything richer is
// enriched server-side in the relay (see apps/relay/src/modules/enrich).
export const ClientContext = z
  .object({
    url: z.string().url().optional(),
    referrer: z.string().optional(),
    user_agent: z.string().optional(),
    ip: z.string().optional(), // set by the relay from the socket, not the client
    locale: z.string().optional(),
  })
  .strict();
export type ClientContext = z.infer<typeof ClientContext>;

const Base = z.object({
  event_id: z.string().uuid(),
  journey_id: z.string().min(1),
  visitor_id: z.string().min(1),
  tenant_id: z.string().min(1),
  ts: z.string().datetime(), // ISO-8601 UTC
  identity: Identity.optional(),
  context: ClientContext.optional(),
});

// Discriminated union — one arm per event name. Adding a new event means a
// new arm here AND downstream schema; that is the whole point of the union.
export const CanonicalEvent = z.discriminatedUnion("name", [
  Base.extend({
    name: z.literal("page_view"),
    props: z.object({ path: z.string() }).strict(),
  }),
  Base.extend({
    name: z.literal("view_item"),
    props: z.object({ item: LineItem }).strict(),
  }),
  Base.extend({
    name: z.literal("add_to_cart"),
    props: z.object({ item: LineItem }).strict(),
  }),
  Base.extend({
    name: z.literal("begin_checkout"),
    props: z
      .object({
        items: z.array(LineItem).min(1),
        value_cents: z.number().int().nonnegative(),
        currency: z.string().length(3),
      })
      .strict(),
  }),
  Base.extend({
    name: z.literal("user_identified"),
    props: z.object({}).strict(),
  }),
  Base.extend({
    name: z.literal("purchase"),
    props: z
      .object({
        order_id: z.string(),
        items: z.array(LineItem).min(1),
        value_cents: z.number().int().nonnegative(),
        currency: z.string().length(3),
      })
      .strict(),
  }),
]);
export type CanonicalEvent = z.infer<typeof CanonicalEvent>;
