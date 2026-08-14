import type { IncomingHttpHeaders } from "node:http";
import { getClientIp, type GeoBackend, type GeoData } from "./index";

// MaxMind GeoLite2-City record shape — we only care about the four fields
// the middleware forwards, so we type only those. Structurally compatible
// with `CityResponse` from the `maxmind` npm package, which lets tests
// inject a plain-object fake without pulling maxmind's types in.
export interface MaxMindCityRecord {
  country?: { iso_code?: string };
  subdivisions?: Array<{ iso_code?: string; names?: { en?: string } }>;
  city?: { names?: { en?: string } };
  postal?: { code?: string };
}

export interface MaxMindReaderLike {
  get(ip: string): MaxMindCityRecord | null;
}

export function createMaxmindBackend(opts: {
  reader: MaxMindReaderLike;
}): GeoBackend {
  return {
    lookup(headers: IncomingHttpHeaders, remoteAddr: string | undefined) {
      const ip = getClientIp(headers, remoteAddr);
      if (!ip) return null;

      let rec: MaxMindCityRecord | null;
      try {
        rec = opts.reader.get(ip);
      } catch {
        // Malformed IP (unlikely — Node's socket gives us a validated one)
        // or DB read error. Fail closed: no headers, not spoofed headers.
        return null;
      }
      if (!rec) return null;

      const data: GeoData = {
        ...(rec.country?.iso_code ? { country: rec.country.iso_code } : {}),
        ...(rec.subdivisions?.[0]?.iso_code
          ? { region: rec.subdivisions[0].iso_code }
          : {}),
        ...(rec.city?.names?.en ? { city: rec.city.names.en } : {}),
        ...(rec.postal?.code ? { postal: rec.postal.code } : {}),
      };
      if (!data.country && !data.region && !data.city && !data.postal) {
        return null;
      }
      return data;
    },
  };
}

// Load the GeoLite2-City DB once at process start. GeoLite2 is 60MB+; the
// `maxmind` package memory-maps it and `Reader.get` is synchronous, so
// per-request lookups are cheap. Dynamic import means CI / tests that never
// touch the maxmind backend don't need the package installed.
export async function loadMaxmindReader(
  dbPath: string,
): Promise<MaxMindReaderLike> {
  const mod = (await import("maxmind")) as unknown as {
    open<T>(path: string): Promise<{ get(ip: string): T | null }>;
  };
  return await mod.open<MaxMindCityRecord>(dbPath);
}
