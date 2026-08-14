// Client-side `_fbc` / `_fbp` handling — mirror of the server-side rule in
// apps/relay/src/ingest/fbc.ts. When the URL carries `?fbclid=…` on first
// landing we synthesise `_fbc = fb.1.{ts}.{fbclid}` per Meta's documented
// format so the value exists BEFORE hop 2 fires; the ingest endpoint (T4)
// also derives the same value from the request, and identical rules on
// both sides make sure the two never disagree.
//
// We also capture `?gclid` into a first-party cookie for symmetry with Google
// Ads — this is the same shape the GA/GAds pixels expect (`_gcl_aw`).

import { readCookie, writeCookie } from "./cookies";

export const FBC_COOKIE = "_fbc";
export const FBP_COOKIE = "_fbp";
export const GCL_COOKIE = "_gcl_aw";

const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

/** Meta's documented shape: `fb.<subdomainIndex>.<createdMs>.<fbclid>`. */
export function buildFbc(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

/** Meta's documented shape for `_fbp`: `fb.<idx>.<createdMs>.<random>`. */
export function buildFbp(nowMs: number, random: number): string {
  return `fb.1.${nowMs}.${random}`;
}

export function readFbc(): string | undefined {
  return readCookie(FBC_COOKIE);
}

export function readFbp(): string | undefined {
  return readCookie(FBP_COOKIE);
}

export function readGclAw(): string | undefined {
  return readCookie(GCL_COOKIE);
}

/**
 * Capture ad-click params from the current URL on landing. Writes cookies
 * only when absent so a repeat page-view doesn't clobber the original click.
 */
export function captureClickParams(input: {
  readonly url: string;
  readonly nowMs: number;
  readonly rng?: () => number;
}): { fbc?: string; gcl?: string } {
  const out: { fbc?: string; gcl?: string } = {};
  let params: URLSearchParams;
  try {
    params = new URL(input.url).searchParams;
  } catch {
    return out;
  }

  const fbclid = params.get("fbclid")?.trim();
  if (fbclid && !readFbc()) {
    const fbc = buildFbc(fbclid, input.nowMs);
    writeCookie(FBC_COOKIE, fbc, { maxAgeSeconds: NINETY_DAYS_SECONDS });
    out.fbc = fbc;
  }

  const gclid = params.get("gclid")?.trim();
  if (gclid && !readGclAw()) {
    // `_gcl_aw`'s real format is `GCL.<ts>.<gclid>` — same intent as fbc.
    const gcl = `GCL.${input.nowMs}.${gclid}`;
    writeCookie(GCL_COOKIE, gcl, { maxAgeSeconds: NINETY_DAYS_SECONDS });
    out.gcl = gcl;
  }

  // Mint `_fbp` if it doesn't exist — the pixel does this itself but we do it
  // eagerly so events that fire BEFORE `initPixel()` (e.g. during hydration
  // races) still carry a stable browser id.
  if (!readFbp()) {
    const random = Math.floor((input.rng?.() ?? Math.random()) * 1e10);
    const fbp = buildFbp(input.nowMs, random);
    writeCookie(FBP_COOKIE, fbp, { maxAgeSeconds: NINETY_DAYS_SECONDS });
  }

  return out;
}
