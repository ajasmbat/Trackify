// Upstream fetch + in-memory cache for Google's gtm.js.
//
// The loader route (routes/loader.ts) calls `fetchGtmJs(id)` to get the raw
// Google response back. This module is responsible for:
//   - performing the HTTPS fetch with `Accept-Encoding: identity` (so the
//     loader can string-rewrite the body without touching gzip),
//   - caching successful responses in-memory keyed on `<gtm-id>`,
//   - respecting `Cache-Control: no-store` from upstream — never cache in
//     that case — otherwise defaulting to a 5-minute TTL.
//
// Rationale for a fixed 5-minute default rather than parsing max-age: Google
// often ships `no-cache` or short max-age values that would make the cache
// pointless. The ticket calls for "at least 5 minutes", so we cap at that.

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_BASE = "https://www.googletagmanager.com/gtm.js";

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

interface CachedEntry {
  response: UpstreamResponse;
  expires: number;
}

export interface UpstreamDeps {
  // Injected for tests. Defaults to global `fetch`.
  fetch?: typeof fetch;
  // In-memory cache TTL in milliseconds. Defaults to 5 minutes.
  ttlMs?: number;
  // Injected time source for tests.
  now?: () => number;
}

export class UpstreamCache {
  private readonly entries = new Map<string, CachedEntry>();
  private readonly inflight = new Map<string, Promise<UpstreamResponse>>();
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(deps: UpstreamDeps = {}) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  async fetchGtmJs(gtmId: string): Promise<UpstreamResponse> {
    const cached = this.entries.get(gtmId);
    if (cached && cached.expires > this.now()) return cached.response;

    const pending = this.inflight.get(gtmId);
    if (pending) return pending;

    const promise = this.fetchFromUpstream(gtmId)
      .then((response) => {
        if (response.status === 200 && this.isCacheable(response.headers)) {
          this.entries.set(gtmId, {
            response,
            expires: this.now() + this.ttlMs,
          });
        }
        return response;
      })
      .finally(() => {
        this.inflight.delete(gtmId);
      });

    this.inflight.set(gtmId, promise);
    return promise;
  }

  private async fetchFromUpstream(gtmId: string): Promise<UpstreamResponse> {
    // Build the URL with URLSearchParams so a hostile `id` value cannot break
    // out of the query string.
    const url = new URL(UPSTREAM_BASE);
    url.searchParams.set("id", gtmId);

    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        // Force identity so we can string-rewrite the body downstream without
        // decompressing gzip/br.
        "accept-encoding": "identity",
      },
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers, body };
  }

  private isCacheable(headers: Record<string, string>): boolean {
    const cc = (headers["cache-control"] ?? "").toLowerCase();
    if (!cc) return true;
    return !cc.split(",").map((s) => s.trim()).includes("no-store");
  }
}
