// Hand-rolled browser globals for the tracking tests. Keeps the storefront
// off jsdom/happy-dom — those aren't in the workspace's devDeps and the code
// under test needs only a small slice of the DOM: cookies, sessionStorage,
// localStorage, navigator, and a fbq shim.

type CookieJar = Map<string, string>;

function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear() {
      m.clear();
    },
    getItem(k) {
      return m.has(k) ? (m.get(k) as string) : null;
    },
    key(i) {
      return Array.from(m.keys())[i] ?? null;
    },
    removeItem(k) {
      m.delete(k);
    },
    setItem(k, v) {
      m.set(k, String(v));
    },
  } as Storage;
}

export interface TrackingTestDom {
  cookies: CookieJar;
  sessionStorage: Storage;
  localStorage: Storage;
  navigator: { userAgent: string; language: string; sendBeacon?: unknown };
  fbqCalls: unknown[][];
  restore: () => void;
}

/**
 * Install browser globals on `globalThis`. Returns a `restore()` that puts
 * the previous globals back so tests don't leak into each other.
 */
export function installTestDom(input?: {
  href?: string;
  cookie?: string;
  withSendBeacon?: boolean;
}): TrackingTestDom {
  const href = input?.href ?? "https://shop.example.test/products/p-101";
  const cookies: CookieJar = new Map();
  if (input?.cookie) {
    for (const part of input.cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) cookies.set(k, v);
    }
  }

  // Node 20+ exposes `navigator` and `location` as accessor properties (no
  // setter), so a bare `globalThis.navigator = …` throws. Redefine each key
  // as a plain configurable data property so `restore()` can put back the
  // original descriptor cleanly.
  const g = globalThis as unknown as Record<string, unknown>;
  const prev: Array<{ key: string; desc: PropertyDescriptor | undefined }> = [];
  const remember = (key: string, value: unknown) => {
    prev.push({ key, desc: Object.getOwnPropertyDescriptor(g, key) });
    Object.defineProperty(g, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  };

  const sessionStorage = makeStorage();
  const localStorage = makeStorage();

  const fbqCalls: unknown[][] = [];
  const fbq = (...args: unknown[]) => {
    fbqCalls.push(args);
  };

  const document = {
    get cookie(): string {
      return Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    set cookie(value: string) {
      const semi = value.indexOf(";");
      const kv = semi >= 0 ? value.slice(0, semi) : value;
      const eq = kv.indexOf("=");
      if (eq < 0) return;
      const k = kv.slice(0, eq).trim();
      const v = decodeURIComponent(kv.slice(eq + 1).trim());
      if (!k) return;
      // Handle Max-Age=0 as delete
      const maxAgeMatch = /Max-Age=([^;]+)/i.exec(value);
      if (maxAgeMatch && Number(maxAgeMatch[1]) <= 0) {
        cookies.delete(k);
        return;
      }
      cookies.set(k, v);
    },
    head: {
      appendChild() {
        // no-op — we don't actually inject the fbevents script in tests
      },
    },
    createElement() {
      return {} as unknown as HTMLElement;
    },
    referrer: "https://source.example.test/",
  };

  const navigator = {
    userAgent: "test-agent/1.0",
    language: "en-US",
    ...(input?.withSendBeacon
      ? {
          sendBeacon: (_url: string, _body: unknown) => true,
        }
      : {}),
  };

  const location = {
    href,
    protocol: new URL(href).protocol,
    hostname: new URL(href).hostname,
  };

  const window = {
    fbq,
    _fbq: fbq,
    location,
    navigator,
    document,
  };

  remember("window", window);
  remember("document", document);
  remember("navigator", navigator);
  remember("location", location);
  remember("sessionStorage", sessionStorage);
  remember("localStorage", localStorage);

  return {
    cookies,
    sessionStorage,
    localStorage,
    navigator,
    fbqCalls,
    restore() {
      for (const { key, desc } of prev) {
        if (desc === undefined) {
          delete g[key];
        } else {
          Object.defineProperty(g, key, desc);
        }
      }
    },
  };
}
