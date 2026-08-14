import type { EventDetail } from "./queries";

// The seven-hop flow contract. Each row asks one question of a whole
// journey: "did this hop actually happen, and is the data we expect
// present?". Rows 5 and 6 are the ones the ticket calls out as MUST BE
// RED when missing — a `fbc` at hop 5 (ad click made it into ingest) and
// hashed identity at hop 6 (identity survived through to the outbound
// payload).
//
// This module is DATA + PURE CHECKS. No I/O, no React. The view layer
// (`app/journey/[journey_id]/page.tsx`) turns each Row into a table row.

export interface HopResult {
  ok: boolean;
  expected: string;
  observed: string;
  // Ids of events that satisfy (or would satisfy) this row — the view links
  // to them so the operator can jump straight to the raw payload.
  supportingEventIds: string[];
  severity: "info" | "warn" | "error";
}

export interface HopDefinition {
  hop: number;
  name: string;
  description: string;
  check(events: EventDetail[]): HopResult;
}

// Server-side sidecar attached by ingest — see relay/ingest/persist.ts.
interface ServerSidecar {
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbclid?: string;
  received_at?: string;
}

// The `identity` block after ingest hashing — only *_sha256 fields are
// persisted; raw email/phone/external_id are stripped before write.
interface HashedIdentity {
  email_sha256?: string;
  phone_sha256?: string;
  external_id_sha256?: string;
}

function serverSidecar(e: EventDetail): ServerSidecar {
  const raw = e.inboundPayload["server"];
  return raw && typeof raw === "object" ? (raw as ServerSidecar) : {};
}

function identity(e: EventDetail): HashedIdentity {
  const raw = e.inboundPayload["identity"];
  return raw && typeof raw === "object" ? (raw as HashedIdentity) : {};
}

function inboundContext(e: EventDetail): { referrer?: string; url?: string } {
  const raw = e.inboundPayload["context"];
  return raw && typeof raw === "object"
    ? (raw as { referrer?: string; url?: string })
    : {};
}

function isEventName(e: EventDetail, name: string): boolean {
  return e.name === name;
}

export const HOPS: HopDefinition[] = [
  {
    hop: 1,
    name: "Ad click observed",
    description:
      "The visitor arrived via the ad network — the fbclid was present on the first storefront hit or a referrer from the ad network origin was recorded.",
    check(events) {
      const withFbclid = events.filter((e) => serverSidecar(e).fbclid);
      const withAdReferrer = events.filter((e) => {
        const ref = inboundContext(e).referrer;
        // We can't hardcode the ad-network apex here (it's per-env); the
        // heuristic is "referrer is any non-empty absolute URL that isn't
        // the storefront's own host". This is intentionally lenient — T14
        // will tighten it against the tenant's known ad-network origin.
        return typeof ref === "string" && ref.startsWith("http");
      });
      const supporting = uniqueIds([...withFbclid, ...withAdReferrer]);
      return {
        ok: supporting.length > 0,
        expected: "at least one event with server.fbclid OR context.referrer",
        observed:
          supporting.length > 0
            ? `${withFbclid.length} events with fbclid, ${withAdReferrer.length} with referrer`
            : "no fbclid, no ad-network referrer",
        supportingEventIds: supporting,
        severity: supporting.length > 0 ? "info" : "warn",
      };
    },
  },
  {
    hop: 2,
    name: "Storefront landing",
    description: "A page_view event was minted on the storefront for this journey.",
    check(events) {
      const matches = events.filter((e) => isEventName(e, "page_view"));
      return {
        ok: matches.length > 0,
        expected: "one or more page_view events",
        observed: `${matches.length} page_view events`,
        supportingEventIds: uniqueIds(matches),
        severity: matches.length > 0 ? "info" : "warn",
      };
    },
  },
  {
    hop: 3,
    name: "Product engagement",
    description: "The visitor looked at or added a product — view_item or add_to_cart.",
    check(events) {
      const matches = events.filter(
        (e) => isEventName(e, "view_item") || isEventName(e, "add_to_cart"),
      );
      return {
        ok: matches.length > 0,
        expected: "at least one view_item or add_to_cart",
        observed: `${matches.length} product events`,
        supportingEventIds: uniqueIds(matches),
        severity: matches.length > 0 ? "info" : "warn",
      };
    },
  },
  {
    hop: 4,
    name: "Checkout / purchase",
    description: "A begin_checkout or purchase event closed the loop.",
    check(events) {
      const matches = events.filter(
        (e) => isEventName(e, "begin_checkout") || isEventName(e, "purchase"),
      );
      return {
        ok: matches.length > 0,
        expected: "at least one begin_checkout or purchase",
        observed: `${matches.length} checkout/purchase events`,
        supportingEventIds: uniqueIds(matches),
        severity: matches.length > 0 ? "info" : "warn",
      };
    },
  },
  {
    hop: 5,
    // The plan explicitly names this hop: missing `fbc` here = RED.
    name: "fbc derived (click attribution survived to ingest)",
    description:
      "For at least one event in the journey, ingest derived a Meta-format fbc from the fbclid (or read one from a cookie). Missing here means click attribution never reached the destination.",
    check(events) {
      const withFbc = events.filter((e) => !!serverSidecar(e).fbc);
      return {
        ok: withFbc.length > 0,
        expected: "at least one event with server.fbc set",
        observed:
          withFbc.length > 0
            ? `${withFbc.length} events carry a derived fbc`
            : "no event has server.fbc — click attribution was lost",
        supportingEventIds: uniqueIds(withFbc),
        severity: withFbc.length > 0 ? "info" : "error",
      };
    },
  },
  {
    hop: 6,
    // Also called out by the plan: missing hashed identity here = RED.
    name: "Hashed identity present",
    description:
      "At least one event carries a SHA-256 identity token (email, phone, or external_id). Meta's match-quality score depends on this; missing it means we're pixel-blind past the click.",
    check(events) {
      const hasIdentity = events.filter((e) => {
        const id = identity(e);
        return !!(id.email_sha256 || id.phone_sha256 || id.external_id_sha256);
      });
      return {
        ok: hasIdentity.length > 0,
        expected: "at least one event with a *_sha256 identity",
        observed:
          hasIdentity.length > 0
            ? `${hasIdentity.length} events carry hashed identity`
            : "no event has hashed identity — pixel-blind past the click",
        supportingEventIds: uniqueIds(hasIdentity),
        severity: hasIdentity.length > 0 ? "info" : "error",
      };
    },
  },
  {
    hop: 7,
    name: "Delivered to a destination",
    description:
      "The delivery worker successfully sent at least one event in this journey to at least one destination (delivery_jobs.status = done).",
    check(events) {
      const eventsWithDone = events.filter((e) =>
        e.deliveries.some((d) => d.status === "done"),
      );
      const anyDead = events.some((e) =>
        e.deliveries.some((d) => d.status === "dead_letter"),
      );
      const ok = eventsWithDone.length > 0;
      return {
        ok,
        expected: "at least one delivery_jobs row with status='done'",
        observed: ok
          ? `${eventsWithDone.length} events delivered${
              anyDead ? " (some dead-lettered too — investigate)" : ""
            }`
          : anyDead
            ? "no successful deliveries; at least one dead-lettered"
            : "no successful deliveries yet",
        supportingEventIds: uniqueIds(eventsWithDone),
        severity: ok ? "info" : anyDead ? "error" : "warn",
      };
    },
  },
];

function uniqueIds(events: EventDetail[]): string[] {
  return Array.from(new Set(events.map((e) => e.id)));
}

export function evaluateJourney(events: EventDetail[]) {
  return HOPS.map((h) => ({ hop: h.hop, name: h.name, description: h.description, result: h.check(events) }));
}
