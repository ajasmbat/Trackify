// Minimal document.cookie helpers. Keeping this tiny and stringly-typed so
// the tracking module has no third-party cookie dependency — the browser
// exposes everything we need. All helpers are safe to call before hydration
// and no-op when there is no `document` (SSR pass, vitest node runner).

export type CookieOptions = {
  readonly maxAgeSeconds?: number;
  readonly path?: string;
  readonly sameSite?: "lax" | "strict" | "none";
  readonly secure?: boolean;
  readonly domain?: string;
};

export function readCookie(name: string, source?: string): string | undefined {
  const raw = source ?? (typeof document === "undefined" ? "" : document.cookie);
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function writeCookie(name: string, value: string, opts: CookieOptions = {}): void {
  if (typeof document === "undefined") return;
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (typeof opts.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  }
  parts.push(`SameSite=${opts.sameSite ?? "lax"}`);
  if (opts.secure ?? location.protocol === "https:") parts.push("Secure");
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  document.cookie = parts.join("; ");
}
