// Per-tenant CORS. Exact-origin match only — no wildcards, no substring rules,
// no `null`/`file://` origins. If the request Origin is not in the tenant's
// allowlist we emit NO `Access-Control-Allow-Origin` header at all (matches
// every mainstream CORS lib and prevents an attacker from probing the list).

export const ALLOW_METHODS = "POST, OPTIONS";
export const ALLOW_HEADERS = "content-type";
export const MAX_AGE_SECONDS = 600;

export interface CorsHeaders {
  /** The exact Origin to echo, or `undefined` when we intentionally omit ACAO. */
  allowOrigin?: string;
  vary: "Origin";
  allowMethods: string;
  allowHeaders: string;
  maxAge: string;
}

export function pickAllowedOrigin(
  origin: string | undefined,
  allowlist: readonly string[],
): string | undefined {
  if (!origin) return undefined;
  return allowlist.includes(origin) ? origin : undefined;
}

export function computeCorsHeaders(
  origin: string | undefined,
  allowlist: readonly string[],
): CorsHeaders {
  return {
    allowOrigin: pickAllowedOrigin(origin, allowlist),
    vary: "Origin",
    allowMethods: ALLOW_METHODS,
    allowHeaders: ALLOW_HEADERS,
    maxAge: String(MAX_AGE_SECONDS),
  };
}

export function isPreflight(
  method: string,
  headers: { "access-control-request-method"?: string | string[] | undefined },
): boolean {
  return (
    method === "OPTIONS" &&
    headers["access-control-request-method"] !== undefined
  );
}
