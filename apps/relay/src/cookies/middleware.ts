import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newJourneyId } from "@trackify/shared";
import { newRelayVisitorId } from "./id";
import {
  formatSetCookie,
  parseCookieHeader,
  type CookieAttrs,
} from "./serialize";

// The cookie service. Two cookies, one HttpOnly + one JS-visible:
//
//   rly_vid   HttpOnly, Secure, SameSite=None, Partitioned. The server's
//             opaque visitor id — the whole point of the ticket is that a
//             server-set cookie survives ITP longer than a JS-written one.
//             T8's loader must NOT try to read it.
//
//   tf_jid    JS-visible (no HttpOnly). Journey continuity — the loader /
//             pixel reads it via document.cookie so a page-reload keeps the
//             same journey_id the server saw on the last request. Same
//             SameSite=None + Partitioned so a cross-site event fetch sends
//             it back.
//
// Both cookies roll forward on every response — Max-Age is re-set, which is
// how "cookie survives N days" is measured in the first place.

export const RELAY_VISITOR_COOKIE = "rly_vid";
export const JOURNEY_COOKIE = "tf_jid";

// 2 years in seconds — the plan's contract with T4's ingest.
export const DEFAULT_VISITOR_MAX_AGE_SECONDS = 63_072_000;
// 6 hours — matches the storefront pixel's short-lived journey cookie
// (see apps/storefront/src/lib/tracking/journey.ts). The journey is a
// "session" concept, not a stable identity.
export const DEFAULT_JOURNEY_MAX_AGE_SECONDS = 60 * 60 * 6;

declare module "fastify" {
  interface FastifyRequest {
    visitorId?: string;
    journeyId?: string;
    /** True when THIS request minted `rly_vid` — reserved for
     *  observability (log lines / metrics). Not part of the cookie's
     *  external contract. */
    visitorIdMinted?: boolean;
  }
}

export interface CookieMiddlewareOptions {
  /** When set, becomes the `Domain=` attribute. Omitted by default so the
   *  cookie is host-only — leaving Domain to production wiring / an env var. */
  cookieDomain?: string;
  visitorMaxAgeSeconds?: number;
  journeyMaxAgeSeconds?: number;
  /** Injectable for deterministic tests. */
  mintVisitorId?: () => string;
  mintJourneyId?: () => string;
  /** Predicate — return true to skip the middleware entirely for a request
   *  (`/healthz`, etc). Defaults to only exempting `/healthz`. */
  exempt?: (req: FastifyRequest) => boolean;
}

const defaultExempt = (req: FastifyRequest): boolean => req.url === "/healthz";

interface ResolvedOptions {
  cookieDomain?: string;
  visitorMaxAgeSeconds: number;
  journeyMaxAgeSeconds: number;
  mintVisitorId: () => string;
  mintJourneyId: () => string;
  exempt: (req: FastifyRequest) => boolean;
}

/**
 * Install the cookie service onto the Fastify app. Two hooks:
 *
 *   onRequest: parse the request Cookie header; mint any missing ids; put
 *              them on `req.visitorId` / `req.journeyId` for downstream
 *              modules.
 *   onSend:    write both Set-Cookie headers so Max-Age rolls forward. We
 *              piggy-back on `onSend` (not `onResponse`) so headers land
 *              before Fastify flushes.
 *
 * Both hooks are global — the middleware needs to see every request that
 * could plausibly issue a cookie. The `exempt` predicate filters out the
 * few endpoints (healthz) that must never touch cookies.
 */
export async function installCookies(
  app: FastifyInstance,
  opts: CookieMiddlewareOptions = {},
): Promise<void> {
  const resolved: ResolvedOptions = {
    cookieDomain: opts.cookieDomain,
    visitorMaxAgeSeconds:
      opts.visitorMaxAgeSeconds ?? DEFAULT_VISITOR_MAX_AGE_SECONDS,
    journeyMaxAgeSeconds:
      opts.journeyMaxAgeSeconds ?? DEFAULT_JOURNEY_MAX_AGE_SECONDS,
    mintVisitorId: opts.mintVisitorId ?? newRelayVisitorId,
    mintJourneyId: opts.mintJourneyId ?? newJourneyId,
    exempt: opts.exempt ?? defaultExempt,
  };

  app.addHook("onRequest", async (req) => {
    if (resolved.exempt(req)) return;

    const cookies = parseCookieHeader(req.headers.cookie);

    const existingVisitor = cookies.get(RELAY_VISITOR_COOKIE);
    if (existingVisitor) {
      req.visitorId = existingVisitor;
    } else {
      req.visitorId = resolved.mintVisitorId();
      req.visitorIdMinted = true;
    }

    // Journey: prefer explicit header (`x-journey-id` — what T8's fetch
    // sends today), then the tf_jid cookie, then mint fresh.
    const headerJourney = req.headers["x-journey-id"];
    if (typeof headerJourney === "string" && headerJourney) {
      req.journeyId = headerJourney;
    } else {
      const cookieJourney = cookies.get(JOURNEY_COOKIE);
      req.journeyId = cookieJourney ?? resolved.mintJourneyId();
    }
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (resolved.exempt(req)) return payload;
    if (!req.visitorId || !req.journeyId) return payload;

    appendSetCookie(
      reply,
      formatSetCookie(RELAY_VISITOR_COOKIE, req.visitorId, {
        domain: resolved.cookieDomain,
        path: "/",
        maxAgeSeconds: resolved.visitorMaxAgeSeconds,
        secure: true,
        httpOnly: true,
        sameSite: "None",
        partitioned: true,
      }),
    );
    appendSetCookie(
      reply,
      formatSetCookie(JOURNEY_COOKIE, req.journeyId, {
        domain: resolved.cookieDomain,
        path: "/",
        maxAgeSeconds: resolved.journeyMaxAgeSeconds,
        secure: true,
        // deliberately NOT HttpOnly — the storefront pixel needs to read this
        sameSite: "None",
        partitioned: true,
      }),
    );
    return payload;
  });
}

/**
 * Fastify's `reply.header("set-cookie", …)` overwrites when called twice.
 * We need both cookies on the response, so read the current value and
 * append. `reply.raw.getHeader` gives us Node's array form.
 */
function appendSetCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader("set-cookie");
  if (existing === undefined) {
    reply.header("set-cookie", cookie);
    return;
  }
  if (Array.isArray(existing)) {
    reply.header("set-cookie", [...existing, cookie]);
    return;
  }
  reply.header("set-cookie", [String(existing), cookie]);
}
