import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLoaderRoutes, type LoaderTenant } from "./route";

const HOST = "https://data.acme.dev";
const KNOWN_PATH = "abc123";
const TENANT: LoaderTenant = { id: "tenant-acme", loaderPath: KNOWN_PATH };

async function build(
  resolver: (path: string) => Promise<LoaderTenant | null>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerLoaderRoutes(app, {
    resolveByLoaderPath: resolver,
    relayOrigin: HOST,
  });
  await app.ready();
  return app;
}

describe("GET /l/:path.js", () => {
  it("serves the per-tenant snippet with application/javascript for a known path", async () => {
    const app = await build(async (p) => (p === KNOWN_PATH ? TENANT : null));
    const res = await app.inject({ method: "GET", url: `/l/${KNOWN_PATH}.js` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.headers["cache-control"]).toContain("max-age=");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // The body embeds the tenant id + host so the browser knows where to send.
    expect(res.body).toContain(JSON.stringify(TENANT.id));
    expect(res.body).toContain(JSON.stringify(HOST));
  });

  it("returns 404 with an empty body for an unknown loader path", async () => {
    const app = await build(async () => null);
    const res = await app.inject({ method: "GET", url: "/l/deadbeef.js" });
    expect(res.statusCode).toBe(404);
    // No body — a probing blocker can't distinguish real vs missing tenants.
    expect(res.body).toBe("");
  });

  it("rejects malformed paths without touching the resolver", async () => {
    let called = 0;
    const app = await build(async () => {
      called++;
      return null;
    });
    // Path traversal, spaces, and too-short segments must all 404 up front.
    for (const bad of ["../etc/passwd", "ab", "with space", "with/slash", "$$$"]) {
      const res = await app.inject({
        method: "GET",
        url: `/l/${encodeURIComponent(bad)}.js`,
      });
      expect(res.statusCode).toBe(404);
    }
    expect(called).toBe(0);
  });

  it("rejects a plain /l/known (no .js suffix) with 404 from Fastify's router", async () => {
    const app = await build(async () => TENANT);
    const res = await app.inject({ method: "GET", url: `/l/${KNOWN_PATH}` });
    expect(res.statusCode).toBe(404);
  });
});
