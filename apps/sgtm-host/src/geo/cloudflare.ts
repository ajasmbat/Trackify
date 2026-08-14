import type { IncomingHttpHeaders } from "node:http";
import type { GeoBackend, GeoData } from "./index";

// Cloudflare's edge stamps every request forwarded to origin with
//   CF-IPCountry   — ISO-3166-1 alpha-2 (or "XX"/"T1" for unknown / Tor)
//   CF-Region-Code — ISO-3166-2 subdivision code (falls back to CF-Region)
//   CF-IPCity      — city name in ASCII
//   CF-Postal-Code — postal/zip
// when the "Add visitor location headers" managed transform is on.
// Docs: https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers
//
// We do not trust these unless the request actually rode through our
// tunnel — the strip-then-apply order in the proxy hook enforces that.

export function createCloudflareBackend(): GeoBackend {
  return {
    lookup(headers: IncomingHttpHeaders): GeoData | null {
      const country = normalise(readHeader(headers, "cf-ipcountry"));
      const region =
        normalise(readHeader(headers, "cf-region-code")) ??
        normalise(readHeader(headers, "cf-region"));
      const city = normalise(readHeader(headers, "cf-ipcity"));
      const postal = normalise(readHeader(headers, "cf-postal-code"));

      if (!country && !region && !city && !postal) return null;
      return {
        ...(country ? { country } : {}),
        ...(region ? { region } : {}),
        ...(city ? { city } : {}),
        ...(postal ? { postal } : {}),
      };
    },
  };
}

function readHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const v = headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

// Cloudflare emits sentinels for unknowns — drop those rather than pass a
// bogus value onward. Everything else is trimmed and passed through.
function normalise(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  if (trimmed === "XX" || trimmed === "T1") return undefined;
  return trimmed;
}
