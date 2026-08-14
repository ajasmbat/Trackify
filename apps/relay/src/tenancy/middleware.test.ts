import { beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  installTenancy,
  DEFAULT_TENANT_TTL_MS,
} from "./middleware";
import { TenantNotFoundError, type TenantContext } from "./resolve";
import { createTtlCache } from "./cache";

const acme = (overrides: Partial<TenantContext["tenant"]> = {}): TenantContext => ({
  tenant: {
    id: "tenant-acme",
    slug: "acme",
    name: "Acme",
    allowedOrigins: ["https://shop.acme.test"],
    ...overrides,
  },
  destinations: [
    {
      id: "dest-a",
      provider: "meta",
      enabled: true,
      config: { pixel_id: "1" },
      credentials: { access_token: "SECRET_ACME" },
    },
  ],
});

async function build(
  resolve: (host: string) => Promise<TenantContext>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await installTenancy(app, { resolve });
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/whoami", async (req) => ({
    tenantId: req.tenant?.tenant.id,
    origins: req.tenant?.tenant.allowedOrigins,
    // Confirm decrypted credentials reach handler-facing code — but do NOT
    // leak them beyond this direct read (this route is test-only).
    tokens: req.tenant?.destinations.map((d) => d.credentials.access_token),
  }));
  await app.ready();
  return app;
}

describe("installTenancy — request lifecycle", () => {
  it("resolves a known host and attaches decrypted context to req.tenant", async () => {
    const app = await build(async (host) => {
      if (host === "shop.acme.test") return acme();
      throw new TenantNotFoundError(host);
    });

    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { host: "shop.acme.test" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tenantId: "tenant-acme",
      origins: ["https://shop.acme.test"],
      tokens: ["SECRET_ACME"],
    });
  });

  it("returns 404 tenant_not_found (never 500) for an unknown host", async () => {
    const app = await build(async (host) => {
      throw new TenantNotFoundError(host);
    });

    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { host: "unknown.example" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ message: "tenant_not_found" });
  });

  it("returns 400 when Host header normalizes to empty", async () => {
    const app = await build(async () => acme());

    // A Host of just `":8443"` (no name, port only) is malformed — Fastify
    // passes it through and our normaliser returns undefined, which is the
    // 400 branch.
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { host: ":8443" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: "missing host header" });
  });

  it("exempts /healthz — no tenant needed", async () => {
    const app = await build(async () => {
      throw new Error("resolver must not run for /healthz");
    });

    const res = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "anything.example" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("echoes Access-Control-Allow-Origin only for an allowlisted origin", async () => {
    const app = await build(async () => acme());
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: {
        host: "shop.acme.test",
        origin: "https://shop.acme.test",
      },
    });

    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://shop.acme.test",
    );
    expect(res.headers["vary"]).toBe("Origin");
    expect(res.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(res.headers["access-control-allow-headers"]).toBe("content-type");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("emits NO ACAO for an off-list origin (silent no-header)", async () => {
    const app = await build(async () => acme());
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: {
        host: "shop.acme.test",
        origin: "https://evil.example",
      },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    // Baseline preflight headers still present — this is a normal GET so the
    // browser wouldn't consult them, but they're safe to include.
    expect(res.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
  });

  it("never emits `*` as ACAO even when Origin matches nothing", async () => {
    const app = await build(async () =>
      acme({ allowedOrigins: ["https://shop.acme.test"] }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: {
        host: "shop.acme.test",
        origin: "https://evil.example",
      },
    });

    for (const v of Object.values(res.headers)) {
      const s = Array.isArray(v) ? v.join(",") : String(v ?? "");
      expect(s).not.toContain("*");
    }
  });

  it("responds to OPTIONS preflight with 204 and full CORS headers", async () => {
    const app = await build(async () => acme());
    const res = await app.inject({
      method: "OPTIONS",
      url: "/e",
      headers: {
        host: "shop.acme.test",
        origin: "https://shop.acme.test",
        "access-control-request-method": "POST",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://shop.acme.test",
    );
    expect(res.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(res.headers["access-control-allow-headers"]).toBe("content-type");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("preflight from off-list origin still returns 204 but no ACAO (browser blocks)", async () => {
    const app = await build(async () => acme());
    const res = await app.inject({
      method: "OPTIONS",
      url: "/e",
      headers: {
        host: "shop.acme.test",
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("strips port from Host before resolver lookup", async () => {
    const seen: string[] = [];
    const app = await build(async (host) => {
      seen.push(host);
      return acme();
    });
    await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { host: "shop.acme.test:8443" },
    });
    expect(seen).toEqual(["shop.acme.test"]);
  });

  it("does NOT leak decrypted credentials into log lines", async () => {
    const logs: string[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        stream: {
          write: (msg: string) => {
            logs.push(msg);
          },
        },
      },
    });
    await installTenancy(app, { resolve: async () => acme() });
    app.get("/whoami", async () => ({ ok: true }));
    await app.ready();

    await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { host: "shop.acme.test" },
    });

    const all = logs.join("\n");
    expect(all).not.toContain("SECRET_ACME");
    expect(all).not.toContain("access_token");
  });
});

describe("installTenancy — cache TTL semantics", () => {
  let clock = 0;
  let calls = 0;
  let currentValue: TenantContext;

  beforeEach(() => {
    clock = 1_000_000;
    calls = 0;
    currentValue = acme({ name: "Acme v1" });
  });

  it("serves stale from cache within TTL and refreshes after expiry", async () => {
    const cache = createTtlCache<TenantContext>(
      async () => {
        calls += 1;
        return currentValue;
      },
      { ttlMs: DEFAULT_TENANT_TTL_MS, now: () => clock },
    );
    const app = Fastify({ logger: false });
    await installTenancy(app, { resolve: (host) => cache.get(host) });
    app.get("/n", async (req) => ({ name: req.tenant?.tenant.name }));
    await app.ready();

    const first = await app.inject({
      method: "GET",
      url: "/n",
      headers: { host: "shop.acme.test" },
    });
    expect(first.json()).toEqual({ name: "Acme v1" });
    expect(calls).toBe(1);

    // Row mutates in the DB — but within TTL the cache still serves the old
    // value.
    currentValue = acme({ name: "Acme v2" });

    clock += DEFAULT_TENANT_TTL_MS - 1;
    const stillStale = await app.inject({
      method: "GET",
      url: "/n",
      headers: { host: "shop.acme.test" },
    });
    expect(stillStale.json()).toEqual({ name: "Acme v1" });
    expect(calls).toBe(1);

    // Cross the TTL boundary — next request refreshes.
    clock += 2;
    const refreshed = await app.inject({
      method: "GET",
      url: "/n",
      headers: { host: "shop.acme.test" },
    });
    expect(refreshed.json()).toEqual({ name: "Acme v2" });
    expect(calls).toBe(2);
  });
});
