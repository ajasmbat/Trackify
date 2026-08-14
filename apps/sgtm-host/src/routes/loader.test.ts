import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { MockDockerClient } from "../docker";
import { FakeRepo } from "../testing/fake-repo";
import { UpstreamCache, type UpstreamResponse } from "../upstream";

const APEX = "sgtm.example.dev";
const HOST = "acme.sgtm.example.dev";

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

// Send a raw HTTP request preserving the Host header (undici's global fetch
// strips it).
function raw(
  port: number,
  opts: { method?: string; path: string; host: string },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path,
        headers: { host: opts.host },
      },
      (res) => {
        let body = "";
        res.on("data", (b: Buffer) => (body += b.toString("utf8")));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// A fetch stub whose Response mimics the shape UpstreamCache expects
// (arrayBuffer + headers.forEach + status).
function stubFetch(
  fn: (url: URL) => {
    status: number;
    headers: Record<string, string>;
    body: string | Buffer;
  },
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const { status, headers, body } = fn(url);
    const bytes =
      typeof body === "string" ? Buffer.from(body, "utf8") : body;
    return {
      status,
      headers: {
        forEach(cb: (v: string, k: string) => void) {
          for (const [k, v] of Object.entries(headers)) cb(v, k);
        },
      },
      async arrayBuffer() {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      },
    } as unknown as Response;
  }) as typeof fetch;
}

describe("loader — /gtm.js", () => {
  let app: FastifyInstance;
  let repo: FakeRepo;

  async function bootWith(upstream: UpstreamCache): Promise<void> {
    repo = new FakeRepo();
    app = await buildApp({
      repo,
      docker: new MockDockerClient(),
      image: "img",
      apex: APEX,
      logger: false,
      proxyCacheTtlMs: 0,
      loaderOverrides: { upstream },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  function appPort(): number {
    const addr = app.server.address();
    return typeof addr === "object" && addr ? addr.port : 0;
  }

  it("proxies gtm.js and rewrites googletagmanager.com to the request host", async () => {
    const upstreamBody =
      "(function(){var s='//www.googletagmanager.com/gtag/js?id=X';return s})();";
    const fetchSpy = vi.fn(
      stubFetch((url) => {
        expect(url.toString()).toBe(
          "https://www.googletagmanager.com/gtm.js?id=GTM-ABC123",
        );
        return {
          status: 200,
          headers: {
            "content-type": "application/javascript",
            "cache-control": "public, max-age=900",
            etag: 'W/"abc"',
            "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
            vary: "Accept-Encoding",
          },
          body: upstreamBody,
        };
      }),
    );
    const upstream = new UpstreamCache({ fetch: fetchSpy });
    await bootWith(upstream);

    const res = await raw(appPort(), { path: "/gtm.js?id=GTM-ABC123", host: HOST });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.headers["cache-control"]).toBe("public, max-age=900");
    expect(res.headers["etag"]).toBe('W/"abc"');
    expect(res.headers["last-modified"]).toBe(
      "Wed, 21 Oct 2026 07:28:00 GMT",
    );
    expect(res.headers["vary"]).toBe("Accept-Encoding");
    expect(res.body).toBe(
      "(function(){var s='//acme.sgtm.example.dev/gtag/js?id=X';return s})();",
    );
    expect(res.body).not.toContain("www.googletagmanager.com");
  });

  it("serves subsequent requests from cache", async () => {
    const fetchSpy = vi.fn(
      stubFetch(() => ({
        status: 200,
        headers: {
          "content-type": "application/javascript",
          "cache-control": "public, max-age=60",
        },
        body: "// gtm body",
      })),
    );
    const upstream = new UpstreamCache({ fetch: fetchSpy });
    await bootWith(upstream);

    await raw(appPort(), { path: "/gtm.js?id=GTM-ABC123", host: HOST });
    await raw(appPort(), { path: "/gtm.js?id=GTM-ABC123", host: HOST });
    await raw(appPort(), { path: "/gtm.js?id=GTM-ABC123", host: HOST });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cache when upstream sends Cache-Control: no-store", async () => {
    const fetchSpy = vi.fn(
      stubFetch(() => ({
        status: 200,
        headers: {
          "content-type": "application/javascript",
          "cache-control": "no-store",
        },
        body: "// gtm body",
      })),
    );
    const upstream = new UpstreamCache({ fetch: fetchSpy });
    await bootWith(upstream);

    await raw(appPort(), { path: "/gtm.js?id=GTM-ABC123", host: HOST });
    await raw(appPort(), { path: "/gtm.js?id=GTM-ABC123", host: HOST });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns 400 missing_container_id when id is absent", async () => {
    const upstream = new UpstreamCache({
      fetch: stubFetch(() => {
        throw new Error("should not be called");
      }),
    });
    await bootWith(upstream);
    const res = await raw(appPort(), { path: "/gtm.js", host: HOST });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "missing_container_id" });
  });

  it("returns 400 invalid_container_id when id is malformed", async () => {
    const upstream = new UpstreamCache({
      fetch: stubFetch(() => {
        throw new Error("should not be called");
      }),
    });
    await bootWith(upstream);
    const res = await raw(appPort(), {
      path: "/gtm.js?id=NOT-A-GTM-ID",
      host: HOST,
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid_container_id" });
  });

  it("URL-encodes the id so a hostile value cannot inject into the upstream URL", async () => {
    // The validation regex should reject this before it hits fetch — this
    // test locks in that behavior so a future regex loosening cannot silently
    // enable an injection.
    const upstream = new UpstreamCache({
      fetch: stubFetch(() => {
        throw new Error("should not be called");
      }),
    });
    await bootWith(upstream);
    const res = await raw(appPort(), {
      path: "/gtm.js?id=GTM-ABC123%26evil=1",
      host: HOST,
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid_container_id" });
  });

  it("returns 400 invalid_host when Host is the bare apex", async () => {
    const upstream = new UpstreamCache({
      fetch: stubFetch(() => {
        throw new Error("should not be called");
      }),
    });
    await bootWith(upstream);
    const res = await raw(appPort(), {
      path: "/gtm.js?id=GTM-ABC123",
      host: APEX,
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid_host" });
  });

  it("passes upstream 404 through without rewriting", async () => {
    const upstream = new UpstreamCache({
      fetch: stubFetch(() => ({
        status: 404,
        headers: { "content-type": "text/plain" },
        body: "Container not found",
      })),
    });
    await bootWith(upstream);
    const res = await raw(appPort(), {
      path: "/gtm.js?id=GTM-ABC123",
      host: HOST,
    });
    expect(res.status).toBe(404);
    expect(res.body).toBe("Container not found");
  });

  it("does NOT get intercepted by the container proxy", async () => {
    // Seed a ready container for the same subdomain — if the proxy stole
    // /gtm.js it would try to connect to hostPort and fail with 502 or
    // similar. Instead the loader should serve it.
    const upstream = new UpstreamCache({
      fetch: stubFetch(() => ({
        status: 200,
        headers: { "content-type": "application/javascript" },
        body: "// loader served this",
      })),
    });
    await bootWith(upstream);
    repo.seed({
      tenantId: "00000000-0000-0000-0000-000000000001",
      subdomain: "acme",
      status: "ready",
      // Deliberately bogus port — the proxy would explode if it tried this.
      containerState: { hostPort: 1 },
    });
    const res = await raw(appPort(), {
      path: "/gtm.js?id=GTM-ABC123",
      host: HOST,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe("// loader served this");
  });
});
