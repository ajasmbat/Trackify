import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { hashEmail, hashPhone } from "@trackify/shared";
import { registerIngestRoutes, type IngestDeps } from "./route";
import type { PersistParams } from "./persist";

interface Harness {
  app: FastifyInstance;
  persistCalls: PersistParams[];
  persistImpl: (p: PersistParams) => Promise<{
    eventRowId: string;
    eventId: string;
    duplicate: boolean;
  }>;
  now: number;
  logs: string[];
}

async function build(
  overrides: Partial<IngestDeps> = {},
  opts: {
    tenant?: {
      tenantId: string;
      allowedOrigins: string[];
      destinations: Array<{ id: string; provider: string }>;
    } | null;
    persistShouldThrow?: boolean;
  } = {},
): Promise<Harness> {
  const persistCalls: PersistParams[] = [];
  const logs: string[] = [];
  const now = 1_700_000_000_000;

  const persistImpl = async (p: PersistParams) => {
    persistCalls.push(p);
    if (opts.persistShouldThrow) throw new Error("persist boom");
    return {
      eventRowId: "row-1",
      eventId: p.event.event_id,
      duplicate: false,
    };
  };

  const resolveTenant = async () =>
    opts.tenant === undefined
      ? {
          tenantId: "tenant-uuid-1",
          allowedOrigins: ["*"],
          destinations: [{ id: "dest-a", provider: "meta" }],
        }
      : opts.tenant;

  const app = Fastify({
    // Route lines pipe through a memory stream we can inspect.
    logger: {
      level: "info",
      stream: {
        write: (msg: string) => {
          logs.push(msg);
        },
      },
    },
  });

  await registerIngestRoutes(app, {
    persist: persistImpl,
    resolveTenant,
    now: () => now,
    ...overrides,
  });
  await app.ready();

  return { app, persistCalls, persistImpl, now, logs };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: "page_view",
    event_id: "11111111-1111-4111-8111-111111111111",
    journey_id: "j-1",
    visitor_id: "v-1",
    tenant_id: "does-not-matter",
    ts: "2026-08-14T00:00:00.000Z",
    props: { path: "/" },
    ...overrides,
  };
}

describe("POST /e", () => {
  it("accepts a valid page_view with 202 and enqueues one job per destination", async () => {
    const h = await build();
    const res = await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: { events: [validEvent()] },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(0);
    expect(body.results[0]).toEqual({
      kind: "ok",
      event_id: validEvent().event_id,
    });
    expect(h.persistCalls).toHaveLength(1);
    expect(h.persistCalls[0]?.destinationIds).toEqual(["dest-a"]);
    expect(h.persistCalls[0]?.tenantId).toBe("tenant-uuid-1");
  });

  it("returns 413 with a message that names the byte limit when body is oversized", async () => {
    const h = await build({ maxBodyBytes: 512 });
    const bigPath = "x".repeat(2048);
    const res = await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: {
        events: [validEvent({ props: { path: `/${bigPath}` } })],
      },
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      error: "Payload Too Large",
      message: expect.stringContaining("512"),
    });
  });

  it("returns 400 with the Zod error path when the body is invalid", async () => {
    const h = await build();
    const res = await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: { events: [{ name: "page_view" }] },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Bad Request");
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("events.0.") }),
      ]),
    );
  });

  it("hashes email + phone BEFORE persist and strips raw values", async () => {
    const h = await build();
    await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: {
        events: [
          validEvent({
            identity: {
              email: "Alice@Example.COM",
              phone: "+1 (415) 555-1234",
            },
          }),
        ],
      },
    });

    const call = h.persistCalls[0];
    expect(call).toBeDefined();
    expect(call?.identity).toEqual({
      email_sha256: hashEmail("alice@example.com"),
      phone_sha256: hashPhone("14155551234"),
    });
    expect(call?.event.identity).toEqual({
      email_sha256: hashEmail("alice@example.com"),
      phone_sha256: hashPhone("14155551234"),
    });
    // Raw values gone from the payload we hand to persist.
    const serialised = JSON.stringify(call);
    expect(serialised).not.toContain("Alice@Example.COM");
    expect(serialised).not.toContain("415) 555-1234");
    expect(serialised).not.toContain("14155551234");
  });

  it("never emits raw PII in log lines", async () => {
    const h = await build();
    await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: {
        events: [
          validEvent({
            identity: { email: "Alice@Example.COM", phone: "14155551234" },
          }),
        ],
      },
    });

    const all = h.logs.join("\n");
    expect(all).not.toContain("Alice@Example.COM");
    expect(all).not.toContain("alice@example.com");
    expect(all).not.toContain("14155551234");
  });

  it("captures client_ip_address from x-forwarded-for (first entry) and user-agent from headers", async () => {
    const h = await build();
    await h.app.inject({
      method: "POST",
      url: "/e",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "user-agent": "TestUA/1.0",
      },
      payload: { events: [validEvent()] },
    });

    const call = h.persistCalls[0];
    expect(call?.server.client_ip_address).toBe("203.0.113.9");
    expect(call?.server.client_user_agent).toBe("TestUA/1.0");
    expect(call?.event.context?.ip).toBe("203.0.113.9");
    expect(call?.event.context?.user_agent).toBe("TestUA/1.0");
  });

  it("derives fbc = fb.1.{now}.{fbclid} when fbclid is in context.url and no _fbc cookie is set", async () => {
    const h = await build();
    await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: {
        events: [
          validEvent({
            context: {
              url: "https://shop.acme.test/product?fbclid=CLICK_ABC",
            },
          }),
        ],
      },
    });

    expect(h.persistCalls[0]?.server.fbc).toBe(`fb.1.${h.now}.CLICK_ABC`);
    expect(h.persistCalls[0]?.server.fbclid).toBe("CLICK_ABC");
  });

  it("uses the _fbc cookie value verbatim when present, ignoring fbclid", async () => {
    const h = await build();
    await h.app.inject({
      method: "POST",
      url: "/e",
      headers: {
        "content-type": "application/json",
        cookie: "_ga=x; _fbc=fb.1.111.EXISTING",
      },
      payload: {
        events: [
          validEvent({
            context: {
              url: "https://shop.acme.test/product?fbclid=SHOULD_IGNORE",
            },
          }),
        ],
      },
    });

    expect(h.persistCalls[0]?.server.fbc).toBe("fb.1.111.EXISTING");
  });

  it("marks the event rejected without crashing when persist throws", async () => {
    const h = await build({}, { persistShouldThrow: true });
    const res = await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: { events: [validEvent()] },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(0);
    expect(body.rejected).toBe(1);
    expect(body.results[0]).toEqual({
      kind: "rejected",
      event_id: validEvent().event_id,
      reason: "persist boom",
    });
  });

  it("responds to CORS preflight with tenant-allowed headers and no DB persist", async () => {
    const h = await build();
    const persistSpy = vi.spyOn(h, "persistImpl");
    const res = await h.app.inject({
      method: "OPTIONS",
      url: "/e",
      headers: {
        origin: "https://shop.example.test",
        "access-control-request-method": "POST",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://shop.example.test",
    );
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-max-age"]).toBe("600");
    expect(persistSpy).not.toHaveBeenCalled();
  });
});

describe("POST /e — no tenant", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 when the resolver finds no tenant", async () => {
    const h = await build({}, { tenant: null });
    const res = await h.app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: { events: [validEvent()] },
    });

    expect(res.statusCode).toBe(404);
    expect(h.persistCalls).toHaveLength(0);
  });
});
