import type { IncomingHttpHeaders } from "node:http";

// GEO enrichment middleware — resolves a request's geo data with the
// process-wide backend (cloudflare | maxmind | off), then injects
// `X-Geo-Country` / `X-Geo-Region` / `X-Geo-City` / `X-Geo-Postal` on the
// outbound request the proxy forwards to the sGTM container. The container's
// GTM tags read those headers as variables.
//
// Trust rule: NEVER trust an inbound `X-Geo-*` from the browser. The proxy
// strips them unconditionally before applying any backend — a signed-in
// customer's GTM tag would otherwise believe a spoofed country and make
// bad routing/consent/tax decisions.

export interface GeoData {
  country?: string; // ISO-3166-1 alpha-2, e.g. "US"
  region?: string; // subdivision iso code, e.g. "CA"
  city?: string; // human name, e.g. "San Francisco"
  postal?: string; // postal / zip code
}

export interface GeoBackend {
  lookup(
    headers: IncomingHttpHeaders,
    remoteAddr: string | undefined,
  ): GeoData | null;
}

export type BackendKind = "cloudflare" | "maxmind" | "off";

export const GEO_HEADER_NAMES = [
  "x-geo-country",
  "x-geo-region",
  "x-geo-city",
  "x-geo-postal",
] as const;

// Headers passed through the proxy hop-by-hop filter live in a
// case-preserved bag; the incoming `req.headers` is already lower-cased by
// Node's HTTP parser, but the outbound bag we build in proxy.ts keeps
// whatever case we hand it. Store both keys lower-cased so equality checks
// against Node's parsed names line up.
export type OutboundHeaderBag = Record<string, string | string[]>;

export function stripInboundGeoHeaders(headers: OutboundHeaderBag): void {
  for (const key of Object.keys(headers)) {
    if (GEO_HEADER_NAMES.includes(key.toLowerCase() as (typeof GEO_HEADER_NAMES)[number])) {
      delete headers[key];
    }
  }
}

export function applyGeoHeaders(
  headers: OutboundHeaderBag,
  data: GeoData,
): void {
  if (data.country) headers["x-geo-country"] = data.country;
  if (data.region) headers["x-geo-region"] = data.region;
  if (data.city) headers["x-geo-city"] = data.city;
  if (data.postal) headers["x-geo-postal"] = data.postal;
}

// Recover the real client IP. Cloudflare's tunnel sets `CF-Connecting-IP`
// with the browser's public address; behind other proxies we fall through
// to the first `X-Forwarded-For` entry, then the raw socket peer. Only the
// maxmind backend actually needs this — cloudflare gets geo from CF-* headers
// directly, no lookup required.
export function getClientIp(
  headers: IncomingHttpHeaders,
  remoteAddr: string | undefined,
): string | undefined {
  const cf = headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();

  const xff = headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : xff;
  if (first) {
    const head = first.split(",")[0]?.trim();
    if (head) return head;
  }
  return remoteAddr;
}

export { createCloudflareBackend } from "./cloudflare";
export {
  createMaxmindBackend,
  loadMaxmindReader,
  type MaxMindReaderLike,
  type MaxMindCityRecord,
} from "./maxmind";

import { createCloudflareBackend } from "./cloudflare";
import { createMaxmindBackend, type MaxMindReaderLike } from "./maxmind";

export interface CreateGeoBackendOptions {
  kind: BackendKind;
  // Required when kind === "maxmind". Injected so tests don't need a real
  // .mmdb file — the maxmind package's Reader is structurally compatible.
  maxmindReader?: MaxMindReaderLike;
}

// Returns `null` when the backend is `off` — callers treat that as "still
// strip inbound X-Geo-*, but never inject." Keeps the caller's branch simple.
export function createGeoBackend(
  opts: CreateGeoBackendOptions,
): GeoBackend | null {
  switch (opts.kind) {
    case "off":
      return null;
    case "cloudflare":
      return createCloudflareBackend();
    case "maxmind":
      if (!opts.maxmindReader) {
        throw new Error(
          "SGTM_GEO_BACKEND=maxmind requires a loaded reader (SGTM_MAXMIND_DB_PATH)",
        );
      }
      return createMaxmindBackend({ reader: opts.maxmindReader });
  }
}
