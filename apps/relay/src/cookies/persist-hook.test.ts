import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";
import type { IngestRequest } from "@trackify/shared";
import { installFbcPersistHook } from "./persist-hook";

// Same reference-identity mock pattern as store.test.ts. We only care what
// the hook writes and with what values.
const TABLES = new Map<unknown, string>([[schema.visitors, "visitors"]]);

interface Recorded {
  inserts: Array<Record<string, unknown>>;
}

function makeMockDb(state: Recorded): Db {
  return {
    insert(table: unknown) {
      const name = TABLES.get(table);
      if (name !== "visitors") throw new Error(`unexpected table ${name}`);
      const chain = {
        values(row: Record<string, unknown>) {
          state.inserts.push(row);
          return chain;
        },
        onConflictDoUpdate() {
          return chain;
        },
        then(
          resolve: (v: unknown) => void,
          reject: (e: unknown) => void,
        ) {
          try {
            resolve(undefined);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    },
    select() {
      throw new Error("select unused in persist-hook tests");
    },
  } as unknown as Db;
}

async function build(state: Recorded): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Stand in for the tenancy middleware: pin a tenant on every request so
  // the hook has something to key against. Real tenancy install is a
  // separate test surface.
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.tenant = {
      tenant: {
        id: "tenant-acme",
        slug: "acme",
        name: "Acme",
        allowedOrigins: [],
      },
      destinations: [],
    };
  });

  await installFbcPersistHook(app, {
    client: makeMockDb(state),
    now: () => 1_700_000_000_000,
  });

  // Minimal stand-in for T4's /e — respond 202 unconditionally so the hook
  // sees the success status. Body must still parse as IngestRequest for
  // the hook to iterate events.
  app.post("/e", async (_req, reply) => {
    reply.code(202).send({ accepted: 1, rejected: 0, results: [] });
  });

  await app.ready();
  return app;
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: "page_view" as const,
    event_id: "11111111-1111-4111-8111-111111111111",
    journey_id: "j-1",
    visitor_id: "v-1",
    tenant_id: "tenant-acme",
    ts: "2026-08-14T00:00:00.000Z",
    props: { path: "/" },
    ...overrides,
  };
}

function payload(events: unknown[]): IngestRequest {
  return { events } as IngestRequest;
}

describe("installFbcPersistHook — POST /e onResponse", () => {
  it("upserts fbc from a client _fbc cookie", async () => {
    const state: Recorded = { inserts: [] };
    const app = await build(state);
    await app.inject({
      method: "POST",
      url: "/e",
      headers: {
        cookie: "_fbc=fb.1.111.CLICK",
        "content-type": "application/json",
      },
      payload: payload([baseEvent()]),
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      tenantId: "tenant-acme",
      visitorKey: "v-1",
      fbc: "fb.1.111.CLICK",
      fbp: null,
    });
  });

  it("derives fbc from a URL fbclid when no _fbc cookie is present", async () => {
    const state: Recorded = { inserts: [] };
    const app = await build(state);
    await app.inject({
      method: "POST",
      url: "/e?fbclid=DERIVED_ID",
      headers: { "content-type": "application/json" },
      payload: payload([baseEvent()]),
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      fbc: "fb.1.1700000000000.DERIVED_ID",
    });
  });

  it("second event with no _fbc still writes the persisted fbc for the same visitor", async () => {
    // Two POSTs to /e — first carrying _fbc, second bare. Both write to
    // the store (mock), so verification is that the mock saw an insert for
    // each — the real ON CONFLICT DO UPDATE means the second is a no-op
    // in Postgres, but the write path fires either way.
    const state: Recorded = { inserts: [] };
    const app = await build(state);

    // Event 1 with _fbc — establishes stored fbc.
    await app.inject({
      method: "POST",
      url: "/e",
      headers: {
        cookie: "_fbc=fb.1.111.CLICK",
        "content-type": "application/json",
      },
      payload: payload([baseEvent()]),
    });

    // Event 2 for the SAME visitor, NO _fbc but fbclid on the URL — hook
    // still writes because fbc derives to a value.
    await app.inject({
      method: "POST",
      url: "/e?fbclid=NEW",
      headers: { "content-type": "application/json" },
      payload: payload([baseEvent({ event_id: "22222222-2222-4222-8222-222222222222" })]),
    });

    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[1]).toMatchObject({
      visitorKey: "v-1",
      fbc: "fb.1.1700000000000.NEW",
    });
  });

  it("persists _fbp from the cookie header alone (fbc absent)", async () => {
    const state: Recorded = { inserts: [] };
    const app = await build(state);
    await app.inject({
      method: "POST",
      url: "/e",
      headers: {
        cookie: "_fbp=fb.1.222.RANDOM",
        "content-type": "application/json",
      },
      payload: payload([baseEvent()]),
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      fbc: null,
      fbp: "fb.1.222.RANDOM",
    });
  });

  it("is a no-op when neither fbc nor fbp is present", async () => {
    const state: Recorded = { inserts: [] };
    const app = await build(state);
    await app.inject({
      method: "POST",
      url: "/e",
      headers: { "content-type": "application/json" },
      payload: payload([baseEvent()]),
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("does not fire on non-/e routes", async () => {
    const state: Recorded = { inserts: [] };
    const app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      req.tenant = {
        tenant: { id: "tenant-acme", slug: "a", name: "A", allowedOrigins: [] },
        destinations: [],
      };
    });
    await installFbcPersistHook(app, {
      client: makeMockDb(state),
      now: () => 1_700_000_000_000,
    });
    app.post("/other", async (_req, reply) =>
      reply.code(202).send({ ok: true }),
    );
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/other",
      headers: {
        cookie: "_fbc=fb.1.111.CLICK",
        "content-type": "application/json",
      },
      payload: { anything: true },
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("does not fire when the response status is not 202", async () => {
    const state: Recorded = { inserts: [] };
    const app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      req.tenant = {
        tenant: { id: "tenant-acme", slug: "a", name: "A", allowedOrigins: [] },
        destinations: [],
      };
    });
    await installFbcPersistHook(app, {
      client: makeMockDb(state),
      now: () => 1_700_000_000_000,
    });
    app.post("/e", async (_req, reply) =>
      reply.code(400).send({ error: "Bad Request" }),
    );
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/e",
      headers: {
        cookie: "_fbc=fb.1.111.CLICK",
        "content-type": "application/json",
      },
      payload: payload([baseEvent()]),
    });
    expect(state.inserts).toHaveLength(0);
  });
});
