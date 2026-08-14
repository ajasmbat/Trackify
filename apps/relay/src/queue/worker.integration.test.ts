import { Pool } from "pg";
import pino from "pino";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { encryptCredentials } from "@trackify/db";
import type { CanonicalEvent } from "@trackify/shared";
import { DestinationRegistry } from "./registry";
import { FakeDestination } from "./fake";
import { createWorker } from "./worker";
import { createEnricher } from "../enrich/pipeline";
import { readStoredIdentity, upsertIdentity } from "../enrich/store";
import { drizzle } from "drizzle-orm/node-postgres";
import * as dbSchema from "@trackify/db/schema";

// Integration tests. Require a live Postgres reachable at DATABASE_URL with
// the Wave 0 schema applied (`pnpm db:push`). When either is unavailable we
// skip the whole file — the unit tests in backoff.test.ts / classify.test.ts
// still gate correctness of the pure pieces.

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://trackify:trackify@localhost:5432/trackify";
const CREDENTIAL_KEY_HEX =
  process.env.CREDENTIAL_KEY_HEX ??
  "0000000000000000000000000000000000000000000000000000000000000000";
// encryptCredentials reads CREDENTIAL_KEY_HEX from process.env — pin it in
// this suite so we don't leak whatever the ambient env has.
process.env.CREDENTIAL_KEY_HEX = CREDENTIAL_KEY_HEX;

// Probe the DB at MODULE LOAD time (top-level await is supported by vitest)
// so describe.skip is picked before test collection runs.
function makePool(size = 4): Pool {
  const p = new Pool({ connectionString: DATABASE_URL, max: size });
  // Swallow idle-connection errors — the reconnect test deliberately kills
  // backends; pg re-emits their errors on the pool and vitest treats them as
  // unhandled otherwise.
  p.on("error", () => {});
  return p;
}

const probe: { pool: Pool | null; ok: boolean } = await (async () => {
  const p = makePool(4);
  try {
    await p.query("SELECT 1");
    const res = await p.query<{ exists: boolean }>(
      `SELECT to_regclass('public.delivery_jobs') IS NOT NULL AS exists`,
    );
    return { pool: p, ok: Boolean(res.rows[0]?.exists) };
  } catch {
    await p.end().catch(() => {});
    return { pool: null, ok: false };
  }
})();

const sharedPool = probe.pool as Pool;
const dbAvailable = probe.ok;

afterAll(async () => {
  await probe.pool?.end();
});

const suite = dbAvailable ? describe : describe.skip;

// Track resources so each test cleans up its own rows and the tenants/dest/etc
// don't leak across tests (they're keyed by test-scoped ids).
const scenarioIds: string[] = []; // used as a suffix seed for isolation

async function makeScenario(pool: Pool): Promise<{
  tenantId: string;
  destinationId: string;
  provider: string;
  makeJob: (opts?: { attempts?: number; status?: string; nextAt?: Date }) => Promise<{
    jobId: string;
    eventId: string;
    event: CanonicalEvent;
  }>;
}> {
  const suffix = Math.random().toString(36).slice(2, 10);
  scenarioIds.push(suffix);
  const provider = `fake-${suffix}`;

  const tenant = await pool.query<{ id: string }>(
    `INSERT INTO tenants (slug, name) VALUES ($1, $1) RETURNING id`,
    [`t-${suffix}`],
  );
  const tenantId = tenant.rows[0]!.id;

  const encrypted = await encryptCredentials({ token: `secret-${suffix}` });
  const dst = await pool.query<{ id: string }>(
    `INSERT INTO destinations (tenant_id, provider, credentials_encrypted)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, provider, encrypted],
  );
  const destinationId = dst.rows[0]!.id;

  const visitor = await pool.query<{ id: string }>(
    `INSERT INTO visitors (tenant_id, visitor_key) VALUES ($1, $2) RETURNING id`,
    [tenantId, `v-${suffix}`],
  );
  const visitorId = visitor.rows[0]!.id;

  return {
    tenantId,
    destinationId,
    provider,
    async makeJob(opts) {
      const evId = crypto.randomUUID();
      const event: CanonicalEvent = {
        event_id: evId,
        journey_id: `j-${suffix}-${evId}`,
        visitor_id: visitorId,
        tenant_id: tenantId,
        ts: new Date().toISOString(),
        name: "page_view",
        props: { path: "/" },
      };
      const eventRow = await pool.query<{ id: string }>(
        `INSERT INTO events (event_id, tenant_id, visitor_id, journey_id, name, ts, inbound_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        [evId, tenantId, visitorId, event.journey_id, event.name, event.ts, JSON.stringify(event)],
      );
      const eventId = eventRow.rows[0]!.id;
      // Explicit next_attempt_at slightly in the past so tests don't race the
      // Postgres clock (the claim WHERE next_attempt_at <= now() would
      // otherwise flake against a system clock a few ms behind the DB).
      const jobRow = await pool.query<{ id: string }>(
        `INSERT INTO delivery_jobs
           (tenant_id, event_id, destination_id, inbound_payload, attempts, status, next_attempt_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, COALESCE($7::timestamptz, now() - interval '1 second'))
         RETURNING id`,
        [
          tenantId,
          eventId,
          destinationId,
          JSON.stringify(event),
          opts?.attempts ?? 0,
          opts?.status ?? "pending",
          opts?.nextAt ?? null,
        ],
      );
      return { jobId: jobRow.rows[0]!.id, eventId, event };
    },
  };
}

const testLogger = pino({ level: "silent" });

suite("delivery worker (Postgres)", () => {
  afterEach(async () => {
    // Rely on ON DELETE CASCADE from tenants to clean up everything created by
    // makeScenario. If a test crashed before its scenario got a tenant, that's
    // fine — nothing was written.
    if (!dbAvailable) return;
    for (const suffix of scenarioIds.splice(0)) {
      await sharedPool!.query(`DELETE FROM tenants WHERE slug = $1`, [`t-${suffix}`]);
    }
  });

  it("`ok` job completes on first attempt; inbound + outbound payloads persist", async () => {
    const scenario = await makeScenario(sharedPool!);
    const registry = new DestinationRegistry();
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "ok" });
    registry.register(fake);

    const { jobId, eventId } = await scenario.makeJob();

    const worker = createWorker({ pool: sharedPool!, registry, logger: testLogger });
    const processed = await worker.processBatch();

    expect(processed).toBe(1);
    const job = await sharedPool!.query(
      `SELECT status, attempts, outbound_payload, last_error, completed_at
         FROM delivery_jobs WHERE id = $1`,
      [jobId],
    );
    expect(job.rows[0]).toMatchObject({
      status: "done",
      attempts: 1,
      last_error: null,
    });
    expect(job.rows[0].outbound_payload).toMatchObject({
      provider: scenario.provider,
      event_id: expect.any(String),
    });
    expect(job.rows[0].completed_at).not.toBeNull();

    const event = await sharedPool!.query(
      `SELECT outbound_per_destination FROM events WHERE id = $1`,
      [eventId],
    );
    expect(event.rows[0].outbound_per_destination[scenario.destinationId]).toMatchObject({
      provider: scenario.provider,
    });
  });

  it("`transient_failure` retries with widening gaps then dead-letters at MAX_ATTEMPTS", async () => {
    const scenario = await makeScenario(sharedPool!);
    const registry = new DestinationRegistry();
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "transient", status: 503, reason: "gateway" });
    registry.register(fake);

    const { jobId } = await scenario.makeJob();

    const worker = createWorker({
      pool: sharedPool!,
      registry,
      logger: testLogger,
      // Force each poll to see the row as due, so we don't have to wait 1s+
      // between attempts.
      claimTtlSeconds: 0,
      rand: () => 0.5, // no jitter
    });

    const status: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Force the row back to "due" so we don't sleep 1..32s in the test.
      await sharedPool!.query(
        `UPDATE delivery_jobs SET next_attempt_at = now() WHERE id = $1`,
        [jobId],
      );
      await worker.processBatch();
      const row = await sharedPool!.query<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM delivery_jobs WHERE id = $1`,
        [jobId],
      );
      status.push(`${row.rows[0]!.status}@${row.rows[0]!.attempts}`);
    }
    // 5 retries then dead-letter on the 6th attempt.
    expect(status).toEqual([
      "retrying@1",
      "retrying@2",
      "retrying@3",
      "retrying@4",
      "retrying@5",
      "dead_letter@6",
    ]);

    const final = await sharedPool!.query<{ last_error: string; status: string }>(
      `SELECT last_error, status FROM delivery_jobs WHERE id = $1`,
      [jobId],
    );
    expect(final.rows[0]!.status).toBe("dead_letter");
    expect(final.rows[0]!.last_error).toContain("attempts_exhausted");
    expect(final.rows[0]!.last_error).toContain("status=503");
  });

  it("`permanent_failure` dead-letters on first attempt (never retries)", async () => {
    const scenario = await makeScenario(sharedPool!);
    const registry = new DestinationRegistry();
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "permanent", status: 400, reason: "bad_request" });
    registry.register(fake);

    const { jobId } = await scenario.makeJob();

    const worker = createWorker({ pool: sharedPool!, registry, logger: testLogger });
    await worker.processBatch();

    const row = await sharedPool!.query<{
      status: string;
      attempts: number;
      last_error: string;
    }>(`SELECT status, attempts, last_error FROM delivery_jobs WHERE id = $1`, [jobId]);
    expect(row.rows[0]!.status).toBe("dead_letter");
    expect(row.rows[0]!.attempts).toBe(1);
    expect(row.rows[0]!.last_error).toContain("status=400");
    expect(row.rows[0]!.last_error).toContain("bad_request");
  });

  it("HTTP 429 is transient; HTTP 400 is permanent (fake adapter, explicit codes)", async () => {
    const scenario = await makeScenario(sharedPool!);
    const registry = new DestinationRegistry();
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    registry.register(fake);

    fake.script(scenario.tenantId, { kind: "transient", status: 429, reason: "throttled" });
    const rateLimited = await scenario.makeJob();
    const worker = createWorker({
      pool: sharedPool!,
      registry,
      logger: testLogger,
      claimTtlSeconds: 0,
      rand: () => 0.5,
    });
    await worker.processBatch();
    const rate = await sharedPool!.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM delivery_jobs WHERE id = $1`,
      [rateLimited.jobId],
    );
    expect(rate.rows[0]!.status).toBe("retrying");
    expect(rate.rows[0]!.attempts).toBe(1);

    // Now switch the script to permanent 400 on the same tenant and enqueue a
    // second job — that one must dead-letter on its first attempt.
    fake.script(scenario.tenantId, { kind: "permanent", status: 400, reason: "malformed" });
    const badRequest = await scenario.makeJob();
    await worker.processBatch();
    const bad = await sharedPool!.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM delivery_jobs WHERE id = $1`,
      [badRequest.jobId],
    );
    expect(bad.rows[0]!.status).toBe("dead_letter");
    expect(bad.rows[0]!.attempts).toBe(1);
  });

  it("two workers against the same Postgres never claim the same job (100 × 2 race)", async () => {
    const scenario = await makeScenario(sharedPool!);
    const registry = new DestinationRegistry();
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "ok" });
    registry.register(fake);

    // 100 pending jobs.
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const j = await scenario.makeJob();
      ids.push(j.jobId);
    }

    // Two workers, own pools, larger batches so the race is aggressive.
    const poolA = makePool(4);
    const poolB = makePool(4);
    const wA = createWorker({ pool: poolA, registry, logger: testLogger, batchSize: 25 });
    const wB = createWorker({ pool: poolB, registry, logger: testLogger, batchSize: 25 });
    try {
      // Drain the whole queue with both workers running in parallel.
      let remaining = 100;
      while (remaining > 0) {
        const [a, b] = await Promise.all([wA.processBatch(), wB.processBatch()]);
        remaining -= a + b;
      }
    } finally {
      await poolA.end();
      await poolB.end();
    }

    // Every job processed exactly once (attempts=1, status=done).
    const rows = await sharedPool!.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM delivery_jobs WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    expect(rows.rows).toHaveLength(100);
    for (const r of rows.rows) {
      expect(r.status).toBe("done");
      expect(r.attempts).toBe(1);
    }
    expect(fake.calls).toHaveLength(100);
  }, 20_000);

  it("worker survives DB connection loss and picks up jobs after reconnect", async () => {
    const scenario = await makeScenario(sharedPool!);
    const registry = new DestinationRegistry();
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "ok" });
    registry.register(fake);

    // Dedicated pool so we can end/recreate without affecting other tests.
    const workerPool = makePool(2);
    const worker = createWorker({ pool: workerPool, registry, logger: testLogger });

    const preJob = await scenario.makeJob();
    await worker.processBatch();
    const pre = await sharedPool!.query<{ status: string }>(
      `SELECT status FROM delivery_jobs WHERE id = $1`,
      [preJob.jobId],
    );
    expect(pre.rows[0]!.status).toBe("done");

    // Terminate all active backends on this pool — simulating Postgres kicking
    // us out. The next processBatch must fail-soft, then succeed.
    await sharedPool!.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name = '' AND pid <> pg_backend_pid()
          AND datname = current_database()`,
    );

    // First tick after the terminate may hit a broken conn — the worker must
    // NOT throw, must return 0, and must recover on the next tick.
    let recovered = false;
    for (let i = 0; i < 20 && !recovered; i++) {
      const postJob = await scenario.makeJob();
      await worker.processBatch();
      const row = await sharedPool!.query<{ status: string }>(
        `SELECT status FROM delivery_jobs WHERE id = $1`,
        [postJob.jobId],
      );
      if (row.rows[0]!.status === "done") recovered = true;
    }
    expect(recovered).toBe(true);

    await workerPool.end();
  }, 15_000);

  // ---------------------------------------------------------------------
  // Enricher (T13) end-to-end. Lives in this file because it shares the
  // delivery-worker Postgres and must serialise with the tests above —
  // running the enricher tests in a separate file races with the
  // pg_terminate_backend test above and the 100×2 cross-worker race.
  // ---------------------------------------------------------------------
  const HASH_EMAIL_ENR = "1".repeat(64);
  const HASH_PHONE_ENR = "2".repeat(64);

  async function makeEventJob(
    scenario: Awaited<ReturnType<typeof makeScenario>>,
    event: CanonicalEvent,
    visitorId: string,
  ): Promise<{ jobId: string; eventId: string }> {
    const eventRow = await sharedPool!.query<{ id: string }>(
      `INSERT INTO events (event_id, tenant_id, visitor_id, journey_id, name, ts, inbound_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [
        event.event_id,
        scenario.tenantId,
        visitorId,
        event.journey_id,
        event.name,
        event.ts,
        JSON.stringify(event),
      ],
    );
    const eventId = eventRow.rows[0]!.id;
    const jobRow = await sharedPool!.query<{ id: string }>(
      `INSERT INTO delivery_jobs
         (tenant_id, event_id, destination_id, inbound_payload, attempts, status, next_attempt_at)
       VALUES ($1, $2, $3, $4::jsonb, 0, 'pending', now() - interval '1 second')
       RETURNING id`,
      [scenario.tenantId, eventId, scenario.destinationId, JSON.stringify(event)],
    );
    return { jobId: jobRow.rows[0]!.id, eventId };
  }

  it("enricher — hop 6: purchase outbound carries em/ph even though inbound did not", async () => {
    const scenario = await makeScenario(sharedPool!);
    // Look up the visitor row created by makeScenario so we can INSERT
    // events against a stable visitor_id/visitor_key.
    const v = await sharedPool!.query<{ id: string; visitor_key: string }>(
      `SELECT id, visitor_key FROM visitors WHERE tenant_id = $1 LIMIT 1`,
      [scenario.tenantId],
    );
    const visitorRowId = v.rows[0]!.id;
    const visitorKey = v.rows[0]!.visitor_key;

    // Stamp identity on the visitor — the exact same call ingest makes on a
    // `user_identified` event, inside its own transaction.
    const tx = drizzle(sharedPool!, { schema: dbSchema });
    await upsertIdentity(tx, {
      tenantId: scenario.tenantId,
      visitorKey,
      identity: { email_sha256: HASH_EMAIL_ENR, phone_sha256: HASH_PHONE_ENR },
    });

    // Purchase with NO identity block on inbound — this is the
    // returning-customer-no-form case the ticket targets.
    const purchase: CanonicalEvent = {
      event_id: crypto.randomUUID(),
      journey_id: `j-hop6-${visitorKey}`,
      visitor_id: visitorKey,
      tenant_id: scenario.tenantId,
      ts: new Date().toISOString(),
      name: "purchase",
      props: {
        order_id: "o-1",
        items: [{ sku: "SKU-1", quantity: 1, price_cents: 1000, currency: "USD" }],
        value_cents: 1000,
        currency: "USD",
      },
    };
    const { jobId, eventId } = await makeEventJob(scenario, purchase, visitorRowId);

    // Fake destination that records exactly what the adapter received.
    const registry = new DestinationRegistry();
    const observed: CanonicalEvent[] = [];
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "ok" });
    const origSend = fake.send.bind(fake);
    fake.send = async (event, credentials) => {
      observed.push(event);
      return origSend(event, credentials);
    };
    registry.register(fake);

    const worker = createWorker({
      pool: sharedPool!,
      registry,
      logger: testLogger,
      enricher: createEnricher({ pool: sharedPool! }),
    });
    const processed = await worker.processBatch();
    expect(processed).toBe(1);

    // Hop 6 proof: adapter saw the enriched event even though the persisted
    // inbound row has no identity block.
    expect(observed).toHaveLength(1);
    expect(observed[0]!.identity?.email_sha256).toBe(HASH_EMAIL_ENR);
    expect(observed[0]!.identity?.phone_sha256).toBe(HASH_PHONE_ENR);

    const eventRow = await sharedPool!.query<{
      inbound_payload: { identity?: unknown };
      outbound_per_destination: Record<string, { event_id: string }>;
    }>(
      `SELECT inbound_payload, outbound_per_destination FROM events WHERE id = $1`,
      [eventId],
    );
    expect(eventRow.rows[0]!.inbound_payload.identity).toBeUndefined();
    expect(eventRow.rows[0]!.outbound_per_destination[scenario.destinationId]).toBeDefined();

    const jobRow = await sharedPool!.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM delivery_jobs WHERE id = $1`,
      [jobId],
    );
    expect(jobRow.rows[0]).toMatchObject({ status: "done", attempts: 1 });
  });

  it("enricher — N events carry identity forward; anonymous events pre-identify get nothing", async () => {
    const scenario = await makeScenario(sharedPool!);
    const v = await sharedPool!.query<{ id: string; visitor_key: string }>(
      `SELECT id, visitor_key FROM visitors WHERE tenant_id = $1 LIMIT 1`,
      [scenario.tenantId],
    );
    const visitorRowId = v.rows[0]!.id;
    const visitorKey = v.rows[0]!.visitor_key;

    const registry = new DestinationRegistry();
    const observed: CanonicalEvent[] = [];
    const fake = new FakeDestination();
    Object.assign(fake, { provider: scenario.provider });
    fake.script(scenario.tenantId, { kind: "ok" });
    const orig = fake.send.bind(fake);
    fake.send = async (e, c) => {
      observed.push(e);
      return orig(e, c);
    };
    registry.register(fake);

    const worker = createWorker({
      pool: sharedPool!,
      registry,
      logger: testLogger,
      enricher: createEnricher({ pool: sharedPool! }),
    });

    // BEFORE identification — anonymous page_view stays anonymous downstream.
    const preIdentify: CanonicalEvent = {
      event_id: crypto.randomUUID(),
      journey_id: `j-carry-${visitorKey}`,
      visitor_id: visitorKey,
      tenant_id: scenario.tenantId,
      ts: new Date().toISOString(),
      name: "page_view",
      props: { path: "/pre" },
    };
    await makeEventJob(scenario, preIdentify, visitorRowId);
    await worker.processBatch();
    expect(observed.at(-1)?.identity).toBeUndefined();

    // Identify.
    const tx = drizzle(sharedPool!, { schema: dbSchema });
    await upsertIdentity(tx, {
      tenantId: scenario.tenantId,
      visitorKey,
      identity: { email_sha256: HASH_EMAIL_ENR },
    });

    // Three subsequent events all carry the stored identity.
    for (const path of ["/a", "/b", "/c"]) {
      const ev: CanonicalEvent = {
        event_id: crypto.randomUUID(),
        journey_id: `j-carry-${visitorKey}`,
        visitor_id: visitorKey,
        tenant_id: scenario.tenantId,
        ts: new Date().toISOString(),
        name: "page_view",
        props: { path },
      };
      await makeEventJob(scenario, ev, visitorRowId);
      await worker.processBatch();
      expect(observed.at(-1)?.identity?.email_sha256).toBe(HASH_EMAIL_ENR);
    }
  });

  it("enricher store — TTL cutoff: identity outside 180d is not returned", async () => {
    const scenario = await makeScenario(sharedPool!);
    const v = await sharedPool!.query<{ visitor_key: string }>(
      `SELECT visitor_key FROM visitors WHERE tenant_id = $1 LIMIT 1`,
      [scenario.tenantId],
    );
    const visitorKey = v.rows[0]!.visitor_key;

    const tx = drizzle(sharedPool!, { schema: dbSchema });
    const stampedAt = new Date("2026-01-01T00:00:00Z");
    await upsertIdentity(tx, {
      tenantId: scenario.tenantId,
      visitorKey,
      identity: { email_sha256: HASH_EMAIL_ENR },
      now: stampedAt,
    });

    const stillFresh = await readStoredIdentity(
      sharedPool!,
      { tenantId: scenario.tenantId, visitorKey },
      { now: new Date("2026-03-01T00:00:00Z") }, // 59d — inside TTL
    );
    expect(stillFresh?.email_sha256).toBe(HASH_EMAIL_ENR);

    const expired = await readStoredIdentity(
      sharedPool!,
      { tenantId: scenario.tenantId, visitorKey },
      { now: new Date("2026-08-01T00:00:00Z") }, // > 180d after stampedAt
    );
    expect(expired).toBeNull();
  });

  it("enricher store — cross-visitor isolation: identity for visitor A is never returned for visitor B", async () => {
    const scenario = await makeScenario(sharedPool!);
    const v = await sharedPool!.query<{ visitor_key: string }>(
      `SELECT visitor_key FROM visitors WHERE tenant_id = $1 LIMIT 1`,
      [scenario.tenantId],
    );
    const visitorKey = v.rows[0]!.visitor_key;

    const tx = drizzle(sharedPool!, { schema: dbSchema });
    await upsertIdentity(tx, {
      tenantId: scenario.tenantId,
      visitorKey,
      identity: { email_sha256: HASH_EMAIL_ENR },
    });

    const stranger = await readStoredIdentity(sharedPool!, {
      tenantId: scenario.tenantId,
      visitorKey: `never-${visitorKey}`,
    });
    expect(stranger).toBeNull();
  });

  it("enricher store — visitor that never identified: read returns null", async () => {
    const scenario = await makeScenario(sharedPool!);
    const v = await sharedPool!.query<{ visitor_key: string }>(
      `SELECT visitor_key FROM visitors WHERE tenant_id = $1 LIMIT 1`,
      [scenario.tenantId],
    );
    const read = await readStoredIdentity(sharedPool!, {
      tenantId: scenario.tenantId,
      visitorKey: v.rows[0]!.visitor_key,
    });
    expect(read).toBeNull();
  });
});
