import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { MockDockerClient } from "../docker";
import { FakeRepo } from "../testing/fake-repo";

const TENANT_ID = "00000000-0000-0000-0000-000000abcdef";

// Boot a tiny local "container" server on an ephemeral port.
async function boot(handler: http.RequestListener): Promise<{
  port: number;
  stop: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    stop: async () => {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

// Node's global fetch (undici) strips the `Host` header (browser forbidden-
// header rules), which is exactly the header we need to test with. Fall back
// to http.request so we control the Host header verbatim.
function raw(
  port: number,
  opts: {
    method?: string;
    path?: string;
    host: string;
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      host: opts.host,
      ...(opts.headers ?? {}),
    };
    if (opts.body) headers["content-length"] = String(Buffer.byteLength(opts.body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path ?? "/",
        headers,
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
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe("proxy — Host-based routing", () => {
  let app: FastifyInstance;
  let repo: FakeRepo;
  let container: { port: number; stop: () => Promise<void> } | null = null;

  beforeEach(async () => {
    repo = new FakeRepo();
    app = await buildApp({
      repo,
      docker: new MockDockerClient(),
      image: "img",
      apex: "sgtm.example.dev",
      logger: false,
      proxyCacheTtlMs: 0,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await app.close();
    if (container) await container.stop();
    container = null;
  });

  function appPort(): number {
    const addr = app.server.address();
    return typeof addr === "object" && addr ? addr.port : 0;
  }

  it("streams a GET to the container matched by <sub>.sgtm.<apex>", async () => {
    const body = "x".repeat(300_000); // >200KB, roughly the size of gtm.js.
    container = await boot((req, res) => {
      res.writeHead(200, {
        "content-type": "application/javascript",
        "x-container-heard": req.headers.host ?? "",
      });
      res.end(body);
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
    });

    // Not /gtm.js — that path belongs to the T20 loader and is exempted
    // from container forwarding by design.
    const res = await raw(appPort(), {
      path: "/gtag/js",
      host: "acme.sgtm.example.dev",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.headers["x-container-heard"]).toBe("acme.sgtm.example.dev");
    expect(res.body.length).toBe(body.length);
  });

  it("returns 404 unknown_container when the subdomain is not in the DB", async () => {
    const res = await raw(appPort(), {
      path: "/anything",
      host: "ghost.sgtm.example.dev",
    });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown_container" });
  });

  it("does not intercept when the request Host does not match the apex", async () => {
    // Host doesn't end in `.sgtm.example.dev` — the proxy hook returns
    // early and Fastify's own router handles the request (no matching
    // route → Fastify's default 404).
    const res = await raw(appPort(), {
      path: "/anything",
      host: "acme.other.example.dev",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when only the apex itself is requested", async () => {
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: 65001 },
    });
    const res = await raw(appPort(), {
      path: "/anything",
      host: "sgtm.example.dev",
    });
    expect(res.status).toBe(404);
  });

  it("does NOT route to a container whose status is not `ready`", async () => {
    container = await boot((_req, res) => {
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "wip",
      status: "provisioning",
      containerState: { hostPort: container.port },
    });
    const res = await raw(appPort(), {
      path: "/foo",
      host: "wip.sgtm.example.dev",
    });
    expect(res.status).toBe(404);
  });

  it("streams a POST body to the container", async () => {
    let received = "";
    container = await boot((req, res) => {
      req.on("data", (b) => (received += b.toString("utf8")));
      req.on("end", () => {
        res.writeHead(200);
        res.end("ok");
      });
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "acme",
      status: "ready",
      containerState: { hostPort: container.port },
    });

    const res = await raw(appPort(), {
      method: "POST",
      path: "/collect",
      host: "acme.sgtm.example.dev",
      body: JSON.stringify({ hello: "world" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(received).toBe('{"hello":"world"}');
  });
});
