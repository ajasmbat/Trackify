import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { MockDockerClient } from "../docker";
import { FakeRepo } from "../testing/fake-repo";
import {
  createCloudflareBackend,
  createGeoBackend,
  createMaxmindBackend,
  type GeoBackend,
  type MaxMindCityRecord,
  type MaxMindReaderLike,
} from "./index";

const TENANT_ID = "00000000-0000-0000-0000-000000abcdef";

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function bootContainer(): Promise<{
  port: number;
  stop: () => Promise<void>;
  received: Received[];
}> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (b: Buffer) => (body += b.toString("utf8")));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    received,
    stop: async () => {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function raw(
  port: number,
  opts: { host: string; path?: string; headers?: Record<string, string> },
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path: opts.path ?? "/",
        headers: { host: opts.host, ...(opts.headers ?? {}) },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function mkApp(geo: GeoBackend | null): Promise<{
  app: FastifyInstance;
  repo: FakeRepo;
  port: number;
}> {
  const repo = new FakeRepo();
  const app = await buildApp({
    repo,
    docker: new MockDockerClient(),
    image: "img",
    apex: "sgtm.example.dev",
    logger: false,
    proxyCacheTtlMs: 0,
    geo,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, repo, port };
}

describe("geo — cloudflare backend", () => {
  it("maps CF-* headers to X-Geo-* on the outbound request", () => {
    const backend = createCloudflareBackend();
    const data = backend.lookup(
      {
        "cf-ipcountry": "US",
        "cf-region-code": "CA",
        "cf-ipcity": "San Francisco",
        "cf-postal-code": "94103",
      },
      undefined,
    );
    expect(data).toEqual({
      country: "US",
      region: "CA",
      city: "San Francisco",
      postal: "94103",
    });
  });

  it("drops Cloudflare sentinels (XX country, T1 Tor)", () => {
    const backend = createCloudflareBackend();
    const data = backend.lookup(
      { "cf-ipcountry": "XX", "cf-region-code": "T1" },
      undefined,
    );
    expect(data).toBeNull();
  });

  it("falls back to CF-Region when CF-Region-Code is absent", () => {
    const backend = createCloudflareBackend();
    const data = backend.lookup(
      { "cf-ipcountry": "US", "cf-region": "CA" },
      undefined,
    );
    expect(data).toEqual({ country: "US", region: "CA" });
  });

  it("returns null when no CF-* header is present", () => {
    const backend = createCloudflareBackend();
    expect(backend.lookup({}, "1.2.3.4")).toBeNull();
  });
});

describe("geo — maxmind backend", () => {
  const record: MaxMindCityRecord = {
    country: { iso_code: "DE" },
    subdivisions: [{ iso_code: "BE", names: { en: "Berlin" } }],
    city: { names: { en: "Berlin" } },
    postal: { code: "10115" },
  };

  it("looks up by CF-Connecting-IP first", () => {
    const seen: string[] = [];
    const reader: MaxMindReaderLike = {
      get(ip) {
        seen.push(ip);
        return record;
      },
    };
    const backend = createMaxmindBackend({ reader });
    const data = backend.lookup(
      { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "1.1.1.1" },
      "192.0.2.7",
    );
    expect(data).toEqual({
      country: "DE",
      region: "BE",
      city: "Berlin",
      postal: "10115",
    });
    expect(seen).toEqual(["203.0.113.10"]);
  });

  it("falls back to the first X-Forwarded-For hop then remoteAddress", () => {
    const seen: string[] = [];
    const reader: MaxMindReaderLike = {
      get(ip) {
        seen.push(ip);
        return record;
      },
    };
    const backend = createMaxmindBackend({ reader });
    backend.lookup({ "x-forwarded-for": "198.51.100.5, 10.0.0.1" }, "10.0.0.1");
    backend.lookup({}, "192.0.2.7");
    expect(seen).toEqual(["198.51.100.5", "192.0.2.7"]);
  });

  it("returns null when the reader has no record for the IP", () => {
    const backend = createMaxmindBackend({ reader: { get: () => null } });
    expect(backend.lookup({}, "192.0.2.7")).toBeNull();
  });

  it("returns null when the reader throws (malformed IP)", () => {
    const backend = createMaxmindBackend({
      reader: {
        get() {
          throw new Error("bad address");
        },
      },
    });
    expect(backend.lookup({}, "not-an-ip")).toBeNull();
  });
});

describe("geo — proxy integration", () => {
  let app: FastifyInstance | null = null;
  let container: Awaited<ReturnType<typeof bootContainer>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    if (container) await container.stop();
    app = null;
    container = null;
  });

  it("cloudflare backend rewrites CF-* into X-Geo-* on the outbound request", async () => {
    container = await bootContainer();
    const wired = await mkApp(createCloudflareBackend());
    app = wired.app;
    wired.repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
    });

    const res = await raw(wired.port, {
      host: "acme.sgtm.example.dev",
      headers: {
        "cf-ipcountry": "US",
        "cf-region-code": "CA",
        "cf-ipcity": "San Francisco",
        "cf-postal-code": "94103",
      },
    });
    expect(res.status).toBe(200);
    const heard = container.received.at(-1)!.headers;
    expect(heard["x-geo-country"]).toBe("US");
    expect(heard["x-geo-region"]).toBe("CA");
    expect(heard["x-geo-city"]).toBe("San Francisco");
    expect(heard["x-geo-postal"]).toBe("94103");
  });

  it("maxmind backend injects X-Geo-* from the reader lookup", async () => {
    container = await bootContainer();
    const reader: MaxMindReaderLike = {
      get: () => ({
        country: { iso_code: "GB" },
        subdivisions: [{ iso_code: "ENG" }],
        city: { names: { en: "London" } },
        postal: { code: "EC1A" },
      }),
    };
    const wired = await mkApp(
      createGeoBackend({ kind: "maxmind", maxmindReader: reader }),
    );
    app = wired.app;
    wired.repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
    });

    const res = await raw(wired.port, {
      host: "acme.sgtm.example.dev",
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    expect(res.status).toBe(200);
    const heard = container.received.at(-1)!.headers;
    expect(heard["x-geo-country"]).toBe("GB");
    expect(heard["x-geo-region"]).toBe("ENG");
    expect(heard["x-geo-city"]).toBe("London");
    expect(heard["x-geo-postal"]).toBe("EC1A");
  });

  it("`off` backend strips inbound X-Geo-* and never re-adds them", async () => {
    container = await bootContainer();
    const wired = await mkApp(createGeoBackend({ kind: "off" }));
    app = wired.app;
    wired.repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
    });

    const res = await raw(wired.port, {
      host: "acme.sgtm.example.dev",
      headers: {
        "x-geo-country": "US",
        "x-geo-region": "CA",
        // Even the CF-* headers on the wire should NOT get re-badged when
        // the backend is off.
        "cf-ipcountry": "DE",
      },
    });
    expect(res.status).toBe(200);
    const heard = container.received.at(-1)!.headers;
    expect(heard["x-geo-country"]).toBeUndefined();
    expect(heard["x-geo-region"]).toBeUndefined();
    expect(heard["x-geo-city"]).toBeUndefined();
    expect(heard["x-geo-postal"]).toBeUndefined();
  });

  it("`geoHeadersEnabled=false` on the container skips injection (but still strips)", async () => {
    container = await bootContainer();
    const wired = await mkApp(createCloudflareBackend());
    app = wired.app;
    wired.repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
      geoHeadersEnabled: false,
    });

    const res = await raw(wired.port, {
      host: "acme.sgtm.example.dev",
      headers: {
        "cf-ipcountry": "US",
        "cf-region-code": "CA",
        // Client also tries to forge — must still be stripped.
        "x-geo-country": "FR",
      },
    });
    expect(res.status).toBe(200);
    const heard = container.received.at(-1)!.headers;
    expect(heard["x-geo-country"]).toBeUndefined();
    expect(heard["x-geo-region"]).toBeUndefined();
  });

  it("strips a browser-forged X-Geo-* before applying the backend value", async () => {
    container = await bootContainer();
    const wired = await mkApp(createCloudflareBackend());
    app = wired.app;
    wired.repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
    });

    const res = await raw(wired.port, {
      host: "acme.sgtm.example.dev",
      headers: {
        // Browser tries to claim they're in France...
        "x-geo-country": "FR",
        // ...but the edge stamps them in the US.
        "cf-ipcountry": "US",
        "cf-region-code": "CA",
      },
    });
    expect(res.status).toBe(200);
    const heard = container.received.at(-1)!.headers;
    expect(heard["x-geo-country"]).toBe("US");
    expect(heard["x-geo-region"]).toBe("CA");
  });
});
