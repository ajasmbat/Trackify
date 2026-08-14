import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "@trackify/shared";
import { createEnricher, passthroughEnricher } from "./pipeline";

// Unit tests for the pipeline factory — the actual SQL is exercised by
// pipeline.integration.test.ts (skipped without DATABASE_URL). Here we just
// verify the enricher forwards (tenant, visitor_key) into the store call
// and merges what comes back.

function pageView(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    event_id: "22222222-2222-2222-2222-222222222222",
    journey_id: "j-2",
    visitor_id: "v-xyz",
    tenant_id: "t-2",
    ts: "2026-08-14T00:00:00.000Z",
    name: "page_view",
    props: { path: "/" },
    ...overrides,
  } as CanonicalEvent;
}

function fakePool(row: unknown) {
  return {
    query: vi.fn().mockResolvedValue({ rows: row === undefined ? [] : [row] }),
  } as unknown as import("pg").Pool;
}

const HASH = "e".repeat(64);

describe("createEnricher", () => {
  it("forwards tenant_id + visitor_id into the store lookup", async () => {
    const pool = fakePool({ identity: { email_sha256: HASH } });
    const enricher = createEnricher({ pool });

    const event = pageView({ tenant_id: "T", visitor_id: "V" });
    const out = await enricher(event);

    expect(out.identity?.email_sha256).toBe(HASH);
    const spy = (pool as unknown as { query: { mock: { calls: unknown[][] } } }).query;
    expect(spy.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["T", "V"]),
    );
  });

  it("returns the event unchanged when no visitor row is found", async () => {
    const pool = fakePool(undefined);
    const enricher = createEnricher({ pool });
    const event = pageView();
    const out = await enricher(event);
    expect(out).toBe(event);
  });

  it("ttlSeconds is passed through to the query parameters", async () => {
    const pool = fakePool(undefined);
    const enricher = createEnricher({ pool, ttlSeconds: 42 });
    await enricher(pageView());
    const spy = (pool as unknown as { query: { mock: { calls: unknown[][] } } }).query;
    expect(spy.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([42]));
  });

  it("passthroughEnricher returns the event by identity (no I/O)", async () => {
    const event = pageView();
    const out = await passthroughEnricher(event);
    expect(out).toBe(event);
  });
});
