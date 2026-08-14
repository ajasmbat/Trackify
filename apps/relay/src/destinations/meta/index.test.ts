import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, hashEmail } from "@trackify/shared";
import type { CanonicalEvent } from "@trackify/shared";
import type { MetaHttpClient, MetaHttpRequest } from "./http";
import { MetaHttpNetworkError } from "./http";
import { createMetaDestination, warnIfTestEventInProduction } from "./index";

const CREDS = {
  pixel_id: "999",
  access_token: "tok-secret",
  test_event_code: "TEST42",
};

function purchaseEvent(): CanonicalEvent {
  return {
    name: "purchase",
    event_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    journey_id: "j-1",
    visitor_id: "v-1",
    tenant_id: "t-1",
    ts: "2026-08-14T12:00:00.000Z",
    identity: { email: "user@example.com" },
    context: { url: "https://shop/checkout" },
    props: {
      order_id: "ord_1",
      items: [{ sku: "s1", quantity: 1, price_cents: 5000, currency: "USD" }],
      value_cents: 5000,
      currency: "USD",
    },
  };
}

function stubHttp(
  response: { status: number; body?: unknown } | { throw: unknown },
): { client: MetaHttpClient; calls: MetaHttpRequest[] } {
  const calls: MetaHttpRequest[] = [];
  const client: MetaHttpClient = async (req) => {
    calls.push(req);
    if ("throw" in response) throw response.throw;
    return { status: response.status, body: response.body ?? {} };
  };
  return { client, calls };
}

describe("createMetaDestination().send", () => {
  it("posts to the pixel events endpoint with access_token in the query string", async () => {
    const { client, calls } = stubHttp({
      status: 200,
      body: { events_received: 1, fbtrace_id: "trace-1" },
    });
    const dest = createMetaDestination({ http: client });

    const result = await dest.send(purchaseEvent(), CREDS);

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe(
      "https://graph.facebook.com/v20.0/999/events?access_token=tok-secret",
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.provider_message_id).toBe("trace-1");
      expect(result.outbound_payload).toEqual(req.body);
    }
  });

  it("returns permanent_failure when config is invalid", async () => {
    const { client } = stubHttp({ status: 200 });
    const dest = createMetaDestination({ http: client });
    const result = await dest.send(purchaseEvent(), { pixel_id: "only" });
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.reason).toContain("access_token");
      expect(result.outbound_payload).toBeNull();
    }
  });

  it("bubbles a 429 as transient_failure", async () => {
    const { client } = stubHttp({
      status: 429,
      body: { error: { message: "throttled" } },
    });
    const dest = createMetaDestination({ http: client });
    const result = await dest.send(purchaseEvent(), CREDS);
    expect(result.kind).toBe("transient_failure");
  });

  it("bubbles a Meta 400 as permanent_failure with Meta's message", async () => {
    const { client } = stubHttp({
      status: 400,
      body: {
        error: { message: "Invalid parameter: user_data.em[0]" },
      },
    });
    const dest = createMetaDestination({ http: client });
    const result = await dest.send(purchaseEvent(), CREDS);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.reason).toContain("Invalid parameter");
    }
  });

  it("maps a network error to transient_failure and still returns the outbound_payload", async () => {
    const { client } = stubHttp({
      throw: new MetaHttpNetworkError("ECONNRESET"),
    });
    const dest = createMetaDestination({ http: client });
    const result = await dest.send(purchaseEvent(), CREDS);
    expect(result.kind).toBe("transient_failure");
    if (result.kind === "transient_failure") {
      expect(result.reason).toBe("ECONNRESET");
      expect(result.outbound_payload).toBeTruthy();
    }
  });

  it("uses the test_event_code from config and never leaks plaintext PII on the wire", async () => {
    const { client, calls } = stubHttp({ status: 200 });
    const dest = createMetaDestination({ http: client });

    await dest.send(purchaseEvent(), CREDS);

    const req = calls[0]!;
    const serialised = JSON.stringify(req.body);
    expect(serialised).not.toContain("user@example.com");
    // hash is present
    expect(serialised).toContain(hashEmail("user@example.com"));
    // test_event_code was forwarded
    expect(serialised).toContain("TEST42");
  });
});

describe("warnIfTestEventInProduction", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger(), "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("warns once per misconfigured destination when NODE_ENV=production", () => {
    const count = warnIfTestEventInProduction(
      [
        { pixel_id: "1", access_token: "t", test_event_code: "TEST" },
        { pixel_id: "2", access_token: "t" },
        { pixel_id: "3", access_token: "t", test_event_code: "TEST2" },
      ],
      { NODE_ENV: "production" } as NodeJS.ProcessEnv,
    );
    expect(count).toBe(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const firstCall = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstCall.code).toBe("meta_test_event_in_prod");
  });

  it("stays silent outside production", () => {
    const count = warnIfTestEventInProduction(
      [{ pixel_id: "1", access_token: "t", test_event_code: "TEST" }],
      { NODE_ENV: "development" } as NodeJS.ProcessEnv,
    );
    expect(count).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// The one thing that keeps Meta's field-name vocabulary contained to this
// folder is this test. If it fails, DO NOT sprinkle the term into other files —
// route the code through this module or extend its API.
describe("meta field-name containment", () => {
  const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
  const META_FOLDER = resolve(__dirname);
  // Names that only Meta uses. Care: exclude generic tokens (`data`, `value`,
  // `currency`) that would false-positive on unrelated code.
  const META_TERMS = [
    "event_source_url",
    "action_source",
    "user_data",
    "custom_data",
    "content_ids",
    "test_event_code",
    "fbc",
    "fbp",
    "fbtrace_id",
    "client_user_agent",
    "client_ip_address",
    "PageView",
    "ViewContent",
    "AddToCart",
    "InitiateCheckout",
    "CompleteRegistration",
    "graph.facebook.com",
  ];

  const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    ".next",
    "coverage",
    ".turbo",
    ".fredrin",
  ]);
  const INCLUDED_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        yield* walk(full);
      } else {
        const ext = entry.slice(entry.lastIndexOf("."));
        if (INCLUDED_EXT.has(ext)) yield full;
      }
    }
  }

  it("Meta-only field names appear only inside apps/relay/src/destinations/meta/**", () => {
    const offenders: Array<{ file: string; term: string }> = [];

    for (const file of walk(REPO_ROOT)) {
      if (file.startsWith(META_FOLDER)) continue;
      const rel = relative(REPO_ROOT, file);
      // Also skip this test file itself — it references the terms by design.
      if (file === __filename) continue;
      const src = readFileSync(file, "utf8");
      for (const term of META_TERMS) {
        if (src.includes(term)) offenders.push({ file: rel, term });
      }
    }

    expect(offenders).toEqual([]);
  });
});
