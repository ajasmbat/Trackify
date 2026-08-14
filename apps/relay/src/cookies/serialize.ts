// Minimal cookie helpers — pulling a whole cookie parser for two headers is
// overkill and adds a supply-chain surface. We only need: parse an incoming
// `Cookie` header into a name → value map, and format a `Set-Cookie` header.

export interface CookieAttrs {
  domain?: string;
  path?: string;
  maxAgeSeconds?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  /** CHIPS partitioning — required alongside SameSite=None for cross-site
   *  cookies in Chrome from 2024+. */
  partitioned?: boolean;
}

export function parseCookieHeader(
  header: string | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    // A later duplicate wins — matches what a browser presents to a server
    // when a cookie is set on multiple paths / domains.
    out.set(name, decodeURIComponent(value));
  }
  return out;
}

export function formatSetCookie(
  name: string,
  value: string,
  attrs: CookieAttrs,
): string {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  if (attrs.domain) parts.push(`Domain=${attrs.domain}`);
  parts.push(`Path=${attrs.path ?? "/"}`);
  if (typeof attrs.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.floor(attrs.maxAgeSeconds)}`);
  }
  if (attrs.sameSite) parts.push(`SameSite=${attrs.sameSite}`);
  if (attrs.secure) parts.push("Secure");
  if (attrs.httpOnly) parts.push("HttpOnly");
  if (attrs.partitioned) parts.push("Partitioned");
  return parts.join("; ");
}
