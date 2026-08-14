// Pin CREDENTIAL_KEY_HEX BEFORE importing the app — the Cookie Keeper path
// transitively loads packages/db/src/crypto, whose env schema demands the key.
process.env.CREDENTIAL_KEY_HEX ??=
  "0000000000000000000000000000000000000000000000000000000000000000";

import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { MockDockerClient } from "../docker";
import { FakeRepo } from "../testing/fake-repo";
import { rewriteSetCookies, rewrittenName } from "../cookies/keeper";

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

    const res = await raw(appPort(), {
      path: "/gtm.js",
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

  // --- Cookie Keeper (T21) ---

  it("rewrites outbound Set-Cookie into HttpOnly Partitioned sgtm_<hash> when cookieKeeperEnabled", async () => {
    container = await boot((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        "set-cookie": "_ga=GA1.2.abcdef; Path=/",
      });
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "cook",
      status: "ready",
      containerState: { hostPort: container.port },
      cookieKeeperEnabled: true,
    });

    const res = await raw(appPort(), {
      path: "/anything",
      host: "cook.sgtm.example.dev",
    });
    expect(res.status).toBe(200);
    const set = res.headers["set-cookie"];
    // Node buffers Set-Cookie into a string[] on the client side.
    const list = Array.isArray(set) ? set : set ? [String(set)] : [];
    expect(list).toHaveLength(1);
    const line = list[0] ?? "";
    const name = line.split(";")[0]?.split("=")[0]?.trim() ?? "";
    expect(name).toBe(rewrittenName("_ga"));
    expect(line).toContain("HttpOnly");
    expect(line).toContain("Secure");
    expect(line).toContain("SameSite=None");
    expect(line).toContain("Partitioned");
    expect(line).toContain("Max-Age=63072000");
    // The rewritten value is NOT the plaintext — it's the sealed blob.
    expect(line).not.toContain("GA1.2.abcdef");
  });

  it("restores inbound sgtm_<hash>=<sealed> into original name=value before forwarding to the container", async () => {
    let receivedCookie = "";
    container = await boot((req, res) => {
      receivedCookie = String(req.headers["cookie"] ?? "");
      res.writeHead(200);
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "cook",
      status: "ready",
      containerState: { hostPort: container.port },
      cookieKeeperEnabled: true,
    });

    const [sealed] = await rewriteSetCookies(["_ga=GA1.2.abcdef; Path=/"]);
    const cookiePair = sealed?.split(";")[0] ?? "";
    expect(cookiePair).not.toBe("");

    const res = await raw(appPort(), {
      path: "/anything",
      host: "cook.sgtm.example.dev",
      headers: { cookie: cookiePair },
    });
    expect(res.status).toBe(200);
    expect(receivedCookie).toBe("_ga=GA1.2.abcdef");
  });

  it("strips tampered sealed cookies before forwarding (auth-tag failure)", async () => {
    let receivedCookie: string | undefined;
    container = await boot((req, res) => {
      receivedCookie = req.headers["cookie"] as string | undefined;
      res.writeHead(200);
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "cook",
      status: "ready",
      containerState: { hostPort: container.port },
      cookieKeeperEnabled: true,
    });

    const [sealed] = await rewriteSetCookies(["_ga=GA1.2.abcdef; Path=/"]);
    const pair = sealed?.split(";")[0] ?? "";
    const [name, value = ""] = pair.split("=", 2);
    const tampered = `${name}=${value.slice(0, -2)}AA`;
    const res = await raw(appPort(), {
      path: "/anything",
      host: "cook.sgtm.example.dev",
      headers: { cookie: tampered },
    });
    expect(res.status).toBe(200);
    // The tampered sealed cookie was the ONLY inbound cookie — the header
    // should be dropped entirely rather than sent as empty.
    expect(receivedCookie).toBeUndefined();
  });

  it("passes Set-Cookie through untouched when cookieKeeperEnabled=false", async () => {
    container = await boot((_req, res) => {
      res.writeHead(200, {
        "set-cookie": "_ga=GA1.2.abcdef; Path=/",
      });
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "raw",
      status: "ready",
      containerState: { hostPort: container.port },
      // cookieKeeperEnabled defaults to false — no rewrite.
    });

    const res = await raw(appPort(), {
      path: "/anything",
      host: "raw.sgtm.example.dev",
    });
    expect(res.status).toBe(200);
    const list = Array.isArray(res.headers["set-cookie"])
      ? (res.headers["set-cookie"] as string[])
      : res.headers["set-cookie"]
        ? [String(res.headers["set-cookie"])]
        : [];
    expect(list).toEqual(["_ga=GA1.2.abcdef; Path=/"]);
  });

  it("propagates Max-Age=0 deletes on the rewritten name", async () => {
    container = await boot((_req, res) => {
      res.writeHead(200, {
        "set-cookie": "_ga=; Path=/; Max-Age=0",
      });
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "cook",
      status: "ready",
      containerState: { hostPort: container.port },
      cookieKeeperEnabled: true,
    });

    const res = await raw(appPort(), {
      path: "/anything",
      host: "cook.sgtm.example.dev",
    });
    expect(res.status).toBe(200);
    const list = Array.isArray(res.headers["set-cookie"])
      ? (res.headers["set-cookie"] as string[])
      : res.headers["set-cookie"]
        ? [String(res.headers["set-cookie"])]
        : [];
    expect(list).toHaveLength(1);
    const line = list[0] ?? "";
    expect(line.startsWith(`${rewrittenName("_ga")}=;`)).toBe(true);
    expect(line).toContain("Max-Age=0");
  });

  it("preserves multiple Set-Cookie headers on one response (does not collapse)", async () => {
    container = await boot((_req, res) => {
      res.writeHead(200, {
        // Node's server serializes an array into repeated Set-Cookie headers.
        "set-cookie": ["_ga=v1; Path=/", "_gid=v2; Path=/"],
      });
      res.end("ok");
    });
    repo.seed({
      tenantId: TENANT_ID,
      subdomain: "cook",
      status: "ready",
      containerState: { hostPort: container.port },
      cookieKeeperEnabled: true,
    });

    const res = await raw(appPort(), {
      path: "/anything",
      host: "cook.sgtm.example.dev",
    });
    expect(res.status).toBe(200);
    const list = Array.isArray(res.headers["set-cookie"])
      ? (res.headers["set-cookie"] as string[])
      : [];
    expect(list).toHaveLength(2);
    const names = list
      .map((line) => line.split(";")[0]?.split("=")[0]?.trim() ?? "");
    expect(names).toEqual([rewrittenName("_ga"), rewrittenName("_gid")]);
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
