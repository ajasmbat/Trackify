// Meta CAPI `fbc` derivation. When a click carries `?fbclid=…` and the visitor
// hasn't yet been tagged with an `_fbc` cookie, we synthesise
// `fb.1.{timestamp-in-ms}.{fbclid}` per Meta's documented rule.
// See https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc

export interface FbcInputs {
  /** Value of the `_fbc` cookie, if the client sent one. */
  cookieFbc?: string;
  /** Raw `fbclid` value pulled from the request (query string / URL / header). */
  fbclid?: string;
  /** Unix epoch in ms; injected so tests are deterministic. */
  now: number;
}

/**
 * Return the `fbc` string to persist, or `undefined` when there is nothing
 * to derive. Cookie wins over derived — an existing cookie is authoritative.
 */
export function deriveFbc(inputs: FbcInputs): string | undefined {
  const cookie = inputs.cookieFbc?.trim();
  if (cookie) return cookie;
  const fbclid = inputs.fbclid?.trim();
  if (!fbclid) return undefined;
  return `fb.1.${inputs.now}.${fbclid}`;
}

/**
 * Pull `_fbc` out of a raw Cookie header without pulling in a cookie parser.
 * Returns undefined when the cookie isn't there.
 */
export function readFbcCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "_fbc") return rest.join("=");
  }
  return undefined;
}

/**
 * Extract `fbclid` from a URL's query string. Returns undefined when the URL
 * is missing, malformed, or has no `fbclid`.
 */
export function readFbclidFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.searchParams.get("fbclid") ?? undefined;
  } catch {
    return undefined;
  }
}
