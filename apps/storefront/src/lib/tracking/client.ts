// The tracking client: the single choke point through which every storefront
// action becomes both a relay CanonicalEvent AND a Meta pixel call sharing
// the SAME `event_id`. This shared id is the deduplication contract — the
// single most consequential detail in the project. Two invariants:
//
//   1. `event_id` is generated ONCE per user action; the identical value is
//      used for the pixel `eventID` argument and the `event_id` field in the
//      relay body.
//   2. The pixel and the relay call are initiated in the SAME JavaScript turn
//      — no `await` between them that could cause one to succeed and the
//      other to drop.
//
// Nothing here hashes PII. The server hashes; if you catch yourself reaching
// for `crypto.subtle.digest('SHA-256', …)` you are in the wrong file (see
// `apps/relay/src/ingest/hash.ts`).

import type { CanonicalEvent, Identity, LineItem } from "@trackify/shared";
import { readFbc, readFbp, readGclAw } from "./fbc";
import { newEventId } from "./ids";
import { getJourneyId, getVisitorId } from "./journey";
import { trackPixelEvent } from "./pixel";

export const RELAY_URL_ENV_KEY = "NEXT_PUBLIC_RELAY_URL";
export const PIXEL_ID_ENV_KEY = "NEXT_PUBLIC_META_PIXEL_ID";
export const TENANT_ID_ENV_KEY = "NEXT_PUBLIC_TENANT_ID";

/** Ingest path on the relay. `NEXT_PUBLIC_RELAY_URL` is a BASE URL — see
 *  `.env.example` and `layout.tsx` (which appends `/l/…` for the loader). */
export const INGEST_PATH = "/e";

const IDENTIFIED_STORAGE = "tf_identified";

/** Discriminated input — one arm per event the storefront ever fires. */
export type TrackInput =
  | { readonly name: "page_view"; readonly path: string }
  | { readonly name: "view_item"; readonly item: LineItem }
  | { readonly name: "add_to_cart"; readonly item: LineItem }
  | {
      readonly name: "begin_checkout";
      readonly items: readonly LineItem[];
      readonly valueCents: number;
      readonly currency: string;
    }
  | {
      readonly name: "purchase";
      readonly orderId: string;
      readonly items: readonly LineItem[];
      readonly valueCents: number;
      readonly currency: string;
    }
  | {
      readonly name: "user_identified";
      readonly identity: { readonly email?: string; readonly phone?: string };
    };

/** Optional overrides — mostly used by tests. */
export interface TrackOptions {
  readonly dedupeKey?: string;
  readonly now?: () => Date;
  readonly relayUrl?: string;
  /** For tests: substitute the fetch/sendBeacon transports. */
  readonly transport?: Transport;
}

export interface Transport {
  send(url: string, body: string, opts: { readonly unloadSafe: boolean }): void;
}

// --- Dedupe registry (defence-in-depth vs hook-level guards) ---------------

const fired = new Set<string>();

export function _resetTrackingForTests(): void {
  fired.clear();
  try {
    sessionStorage?.removeItem(IDENTIFIED_STORAGE);
  } catch {
    // ignore — no storage in this environment
  }
}

// --- Environment reads -----------------------------------------------------

function readEnv(key: string): string | undefined {
  // Next.js inlines `process.env.NEXT_PUBLIC_*` at build time — the runtime
  // process object is empty in the browser bundle. Reading via a lookup keeps
  // Node-side tests happy too.
  const v = (process.env as Record<string, string | undefined>)[key];
  return v && v.length > 0 ? v : undefined;
}

function resolveRelayUrl(override?: string): string | undefined {
  return override ?? readEnv(RELAY_URL_ENV_KEY);
}

/**
 * Build the ingest endpoint URL from a base URL. `NEXT_PUBLIC_RELAY_URL` is
 * documented as a base (e.g. `https://data.example.dev` or
 * `http://localhost:3003`); the tracker owns the ingest path. `new URL()`
 * handles trailing slashes and existing paths on the base for us.
 */
function buildIngestUrl(base: string): string {
  return new URL(INGEST_PATH, base.endsWith("/") ? base : `${base}/`).toString();
}

function resolveTenantId(): string {
  const fromEnv = readEnv(TENANT_ID_ENV_KEY);
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  return "unknown";
}

// --- Transports ------------------------------------------------------------

/**
 * Pick the right transport for the event. Purchase + begin_checkout must
 * survive the user navigating away, so we use `sendBeacon` (or the
 * `fetch(keepalive)` fallback). Everything else can afford a regular fetch.
 */
export const defaultTransport: Transport = {
  send(url, body, { unloadSafe }) {
    if (typeof navigator === "undefined") return;
    const type = "application/json";
    if (unloadSafe) {
      if (typeof navigator.sendBeacon === "function") {
        try {
          const ok = navigator.sendBeacon(url, new Blob([body], { type }));
          if (ok) return;
        } catch {
          // fall through to fetch(keepalive)
        }
      }
      // fetch(keepalive) can survive unload up to ~64 KB.
      void fetch(url, {
        method: "POST",
        headers: { "content-type": type },
        body,
        keepalive: true,
        credentials: "include",
      }).catch(() => {});
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "content-type": type },
      body,
      credentials: "include",
    }).catch(() => {});
  },
};

function isUnloadSafe(name: TrackInput["name"]): boolean {
  return name === "purchase" || name === "begin_checkout";
}

// --- Identity state --------------------------------------------------------

export function markIdentified(): void {
  try {
    sessionStorage?.setItem(IDENTIFIED_STORAGE, "1");
  } catch {
    // ignore
  }
}

export function isKnownVisitor(): boolean {
  try {
    return sessionStorage?.getItem(IDENTIFIED_STORAGE) === "1";
  } catch {
    return false;
  }
}

// --- Payload shaping -------------------------------------------------------

function normaliseIdentity(input: { email?: string; phone?: string }): Identity | undefined {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  if (!email && !phone) return undefined;
  const out: Identity = {};
  if (email) out.email = email;
  if (phone) out.phone = phone;
  return out;
}

function toPixelParams(input: TrackInput): Record<string, unknown> {
  switch (input.name) {
    case "page_view":
      return {};
    case "view_item":
      return {
        content_ids: [input.item.sku],
        content_type: "product",
        value: input.item.price_cents / 100,
        currency: input.item.currency,
      };
    case "add_to_cart":
      return {
        content_ids: [input.item.sku],
        content_type: "product",
        value: (input.item.price_cents * input.item.quantity) / 100,
        currency: input.item.currency,
      };
    case "begin_checkout":
      return {
        content_ids: input.items.map((i) => i.sku),
        content_type: "product",
        num_items: input.items.reduce((a, i) => a + i.quantity, 0),
        value: input.valueCents / 100,
        currency: input.currency,
      };
    case "purchase":
      return {
        content_ids: input.items.map((i) => i.sku),
        content_type: "product",
        num_items: input.items.reduce((a, i) => a + i.quantity, 0),
        value: input.valueCents / 100,
        currency: input.currency,
        order_id: input.orderId,
      };
    case "user_identified":
      return {};
  }
}

function toCanonicalEvent(
  input: TrackInput,
  ctx: { eventId: string; ts: string; tenantId: string; journeyId: string; visitorId: string },
): CanonicalEvent {
  const base = {
    event_id: ctx.eventId,
    journey_id: ctx.journeyId,
    visitor_id: ctx.visitorId,
    tenant_id: ctx.tenantId,
    ts: ctx.ts,
    context: browserContext(),
  } as const;

  switch (input.name) {
    case "page_view":
      return { ...base, name: "page_view", props: { path: input.path } };
    case "view_item":
      return { ...base, name: "view_item", props: { item: input.item } };
    case "add_to_cart":
      return { ...base, name: "add_to_cart", props: { item: input.item } };
    case "begin_checkout":
      return {
        ...base,
        name: "begin_checkout",
        props: {
          items: [...input.items],
          value_cents: input.valueCents,
          currency: input.currency,
        },
      };
    case "purchase":
      return {
        ...base,
        name: "purchase",
        props: {
          order_id: input.orderId,
          items: [...input.items],
          value_cents: input.valueCents,
          currency: input.currency,
        },
      };
    case "user_identified":
      return {
        ...base,
        name: "user_identified",
        identity: normaliseIdentity(input.identity),
        props: {},
      };
  }
}

function browserContext(): CanonicalEvent["context"] {
  if (typeof window === "undefined") return undefined;
  const url = window.location?.href;
  const referrer = document?.referrer || undefined;
  const user_agent = navigator?.userAgent;
  const locale = navigator?.language;
  const ctx: NonNullable<CanonicalEvent["context"]> = {};
  if (url) ctx.url = url;
  if (referrer) ctx.referrer = referrer;
  if (user_agent) ctx.user_agent = user_agent;
  if (locale) ctx.locale = locale;
  return Object.keys(ctx).length === 0 ? undefined : ctx;
}

// --- Public API ------------------------------------------------------------

export interface TrackResult {
  readonly eventId: string;
  /** Set only when the event was suppressed by dedupe or missing config. */
  readonly suppressed?: "duplicate" | "no-relay-url";
}

/**
 * Fire a canonical event. Pixel and relay call are dispatched in the same
 * JS turn — the pixel call is synchronous and the relay call is a queued
 * sendBeacon/fetch (no `await` here).
 */
export function track(input: TrackInput, opts: TrackOptions = {}): TrackResult {
  const dedupeKey = opts.dedupeKey;
  if (dedupeKey) {
    if (fired.has(dedupeKey)) {
      return { eventId: "", suppressed: "duplicate" };
    }
    fired.add(dedupeKey);
  }

  const now = opts.now ?? (() => new Date());
  const eventId = newEventId();
  const canonical = toCanonicalEvent(input, {
    eventId,
    ts: now().toISOString(),
    tenantId: resolveTenantId(),
    journeyId: getJourneyId(),
    visitorId: getVisitorId(),
  });

  // (1) Pixel — synchronous. Runs first so a network hiccup on the relay
  // call can't drop our browser conversion. Standard events only.
  const pixelParams = toPixelParams(input);
  // Enrich pixel params with ad-attribution ids Meta reads out of the pixel
  // call in some flows. Keeps the browser-side signal parity with the CAPI
  // server-side call built in T6.
  const fbp = readFbp();
  const fbc = readFbc();
  const gcl = readGclAw();
  if (fbp) pixelParams.fbp = fbp;
  if (fbc) pixelParams.fbc = fbc;
  if (gcl) pixelParams.gcl_aw = gcl;
  trackPixelEvent(canonical.name, pixelParams, eventId);

  // (2) Relay — non-blocking. sendBeacon for unload-safe events, fetch for
  // the rest. NO await between these two calls.
  const relayBase = resolveRelayUrl(opts.relayUrl);
  if (!relayBase) {
    // Development or misconfig: the pixel still fires but the relay call is
    // silently dropped. In prod the boot check (loadEnv in the app it's
    // deployed to) is expected to catch this earlier. Warn in dev so the
    // next reporter finds it in 30 seconds instead of an hour.
    warnSuppressed(`${RELAY_URL_ENV_KEY} is not set — relay call dropped`);
    return { eventId, suppressed: "no-relay-url" };
  }
  const transport = opts.transport ?? defaultTransport;
  const body = JSON.stringify({ events: [canonical] });
  transport.send(buildIngestUrl(relayBase), body, {
    unloadSafe: isUnloadSafe(input.name),
  });

  return { eventId };
}

function warnSuppressed(message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  console.warn(`[trackify] ${message}`);
}

/**
 * Convenience wrapper — fires `user_identified` with plaintext PII and marks
 * the visitor as known so subsequent events can flip UX. The RELAY hashes;
 * nothing here should ever call `crypto.subtle.digest`.
 */
export function identify(
  identity: { email?: string; phone?: string },
  opts: TrackOptions = {},
): TrackResult {
  markIdentified();
  return track({ name: "user_identified", identity }, opts);
}
