import { CanonicalEvent } from "@trackify/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PIXEL_ID_ENV_KEY,
  RELAY_URL_ENV_KEY,
  TENANT_ID_ENV_KEY,
  type Transport,
  _resetTrackingForTests,
  identify,
  isKnownVisitor,
  track,
} from "./client";
import { _resetPixelForTests, initPixel } from "./pixel";
import { type TrackingTestDom, installTestDom } from "./test-dom";

// The single most consequential property in the project: the event_id used
// for the pixel call and the event_id sent to the relay MUST be identical.
// This whole test file exists to snoop both calls and prove they match.

interface CapturedSend {
  url: string;
  body: string;
  unloadSafe: boolean;
}

function makeCapturingTransport(): { transport: Transport; sends: CapturedSend[] } {
  const sends: CapturedSend[] = [];
  const transport: Transport = {
    send(url, body, { unloadSafe }) {
      sends.push({ url, body, unloadSafe });
    },
  };
  return { transport, sends };
}

const RELAY_URL = "https://relay.example.test/e";
const TENANT = "shop.example.test";

let dom: TrackingTestDom;

beforeEach(() => {
  process.env[RELAY_URL_ENV_KEY] = RELAY_URL;
  process.env[TENANT_ID_ENV_KEY] = TENANT;
  process.env[PIXEL_ID_ENV_KEY] = "PXL-TEST-1";
  dom = installTestDom({ href: "https://shop.example.test/products/p-101" });
  initPixel("PXL-TEST-1");
  _resetTrackingForTests();
});

afterEach(() => {
  _resetPixelForTests();
  dom.restore();
  // Node coerces `process.env.X = undefined` to the string "undefined", so
  // we genuinely need `delete` here — assigning any other value would leak
  // stale config into the next test.
  delete process.env[RELAY_URL_ENV_KEY];
  delete process.env[TENANT_ID_ENV_KEY];
  delete process.env[PIXEL_ID_ENV_KEY];
});

function extractPixelEventId(fbqCalls: unknown[][]): string | undefined {
  for (const args of fbqCalls) {
    if (args[0] !== "track") continue;
    const meta = args[3] as { eventID?: string } | undefined;
    if (meta?.eventID) return meta.eventID;
  }
  return undefined;
}

describe("event_id dedup contract", () => {
  const item = { sku: "p-101", quantity: 1, price_cents: 1800, currency: "USD" } as const;
  const cases: Array<{ label: string; input: import("./client").TrackInput }> = [
    { label: "page_view", input: { name: "page_view", path: "/" } },
    { label: "view_item", input: { name: "view_item", item } },
    { label: "add_to_cart", input: { name: "add_to_cart", item: { ...item, quantity: 2 } } },
    {
      label: "begin_checkout",
      input: {
        name: "begin_checkout",
        items: [item],
        valueCents: 1800,
        currency: "USD",
      },
    },
    {
      label: "purchase",
      input: {
        name: "purchase",
        orderId: "ord_abc",
        items: [item],
        valueCents: 1800,
        currency: "USD",
      },
    },
  ];

  for (const c of cases) {
    it(`${c.label}: pixel eventID === relay event_id`, () => {
      const { transport, sends } = makeCapturingTransport();
      const { eventId } = track(c.input, { transport });

      expect(eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
      expect(sends).toHaveLength(1);
      const parsed = JSON.parse(sends[0]!.body) as { events: unknown[] };
      const parsedEvent = CanonicalEvent.parse(parsed.events[0]);
      expect(parsedEvent.event_id).toBe(eventId);

      const pixelEventId = extractPixelEventId(dom.fbqCalls);
      expect(pixelEventId).toBe(eventId);
    });
  }
});

describe("payload shaping", () => {
  it("includes browser context and journey/visitor ids on every event", () => {
    const { transport, sends } = makeCapturingTransport();
    track({ name: "page_view", path: "/products/p-101" }, { transport });
    const parsed = CanonicalEvent.parse(JSON.parse(sends[0]!.body).events[0]);
    expect(parsed.tenant_id).toBe(TENANT);
    expect(parsed.journey_id).toBeTruthy();
    expect(parsed.visitor_id).toBeTruthy();
    expect(parsed.context?.url).toBe("https://shop.example.test/products/p-101");
    expect(parsed.context?.user_agent).toBe("test-agent/1.0");
    expect(parsed.context?.locale).toBe("en-US");
  });

  it("carries a stable journey_id across events in the same session", () => {
    const { transport, sends } = makeCapturingTransport();
    track({ name: "page_view", path: "/" }, { transport });
    track({ name: "page_view", path: "/products/p-101" }, { transport });
    const first = CanonicalEvent.parse(JSON.parse(sends[0]!.body).events[0]);
    const second = CanonicalEvent.parse(JSON.parse(sends[1]!.body).events[0]);
    expect(first.journey_id).toBe(second.journey_id);
    expect(first.visitor_id).toBe(second.visitor_id);
  });

  it("routes purchase and begin_checkout through the unload-safe transport", () => {
    const { transport, sends } = makeCapturingTransport();
    track({ name: "page_view", path: "/" }, { transport });
    track(
      {
        name: "begin_checkout",
        items: [{ sku: "p-101", quantity: 1, price_cents: 1800, currency: "USD" }],
        valueCents: 1800,
        currency: "USD",
      },
      { transport },
    );
    track(
      {
        name: "purchase",
        orderId: "ord_xyz",
        items: [{ sku: "p-101", quantity: 1, price_cents: 1800, currency: "USD" }],
        valueCents: 1800,
        currency: "USD",
      },
      { transport },
    );
    expect(sends.map((s) => s.unloadSafe)).toEqual([false, true, true]);
  });
});

describe("dedupe", () => {
  it("suppresses a second call with the same dedupeKey", () => {
    const { transport, sends } = makeCapturingTransport();
    const a = track(
      { name: "view_item", item: line("p-101") },
      { transport, dedupeKey: "vi:p-101" },
    );
    const b = track(
      { name: "view_item", item: line("p-101") },
      { transport, dedupeKey: "vi:p-101" },
    );
    expect(a.suppressed).toBeUndefined();
    expect(b.suppressed).toBe("duplicate");
    expect(sends).toHaveLength(1);
  });
});

describe("identify", () => {
  it("fires user_identified with plaintext PII and flips the known-visitor flag", () => {
    const { transport, sends } = makeCapturingTransport();
    expect(isKnownVisitor()).toBe(false);
    identify({ email: "  Jane@Example.COM ", phone: "+1 415 555 0100" }, { transport });
    expect(isKnownVisitor()).toBe(true);
    const parsed = CanonicalEvent.parse(JSON.parse(sends[0]!.body).events[0]);
    expect(parsed.name).toBe("user_identified");
    expect(parsed.identity?.email).toBe("jane@example.com");
    expect(parsed.identity?.phone).toBe("+1 415 555 0100");
    // No hashes minted client-side — the server does that.
    expect(parsed.identity?.email_sha256).toBeUndefined();
    expect(parsed.identity?.phone_sha256).toBeUndefined();
  });
});

describe("missing config", () => {
  it("suppresses the relay call when RELAY_URL is unset but still fires the pixel", () => {
    delete process.env[RELAY_URL_ENV_KEY];
    const { transport, sends } = makeCapturingTransport();
    const res = track({ name: "page_view", path: "/" }, { transport });
    expect(res.suppressed).toBe("no-relay-url");
    expect(sends).toHaveLength(0);
    expect(extractPixelEventId(dom.fbqCalls)).toBe(res.eventId);
  });
});

function line(sku: string) {
  return { sku, quantity: 1, price_cents: 1800, currency: "USD" };
}
