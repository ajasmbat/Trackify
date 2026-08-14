import { describe, expect, it } from "vitest";
import { hashEmail, hashPhone } from "@trackify/shared";
import type { CanonicalEvent } from "@trackify/shared";
import { buildMetaRequestBody } from "./payload";

const TS = "2026-08-14T12:00:00.000Z";
const EVENT_ID = "11111111-2222-3333-4444-555555555555";

function basePurchase(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "purchase",
    event_id: EVENT_ID,
    journey_id: "j-1",
    visitor_id: "v-1",
    tenant_id: "t-1",
    ts: TS,
    identity: {
      email: "  Foo@Bar.COM  ",
      phone: "+1 (415) 555-1234",
    },
    context: {
      url: "https://shop.example.com/checkout",
      user_agent: "Mozilla/5.0 test",
      ip: "203.0.113.5",
    },
    props: {
      order_id: "ord_1",
      items: [
        { sku: "sku-1", quantity: 1, price_cents: 4999, currency: "USD" },
        { sku: "sku-2", quantity: 2, price_cents: 2500, currency: "USD" },
      ],
      value_cents: 9999,
      currency: "USD",
    },
    ...overrides,
  } as CanonicalEvent;
}

describe("buildMetaRequestBody", () => {
  it("maps a purchase into Meta's documented shape", () => {
    const body = buildMetaRequestBody({ event: basePurchase() });

    expect(body.data).toHaveLength(1);
    const [evt] = body.data;
    expect(evt.event_name).toBe("Purchase");
    expect(evt.event_time).toBe(Math.floor(new Date(TS).getTime() / 1000));
    expect(evt.event_id).toBe(EVENT_ID);
    expect(evt.action_source).toBe("website");
    expect(evt.event_source_url).toBe("https://shop.example.com/checkout");
    expect(evt.user_data.em).toEqual([hashEmail("  Foo@Bar.COM  ")]);
    expect(evt.user_data.ph).toEqual([hashPhone("+1 (415) 555-1234")]);
    expect(evt.user_data.client_ip_address).toBe("203.0.113.5");
    expect(evt.user_data.client_user_agent).toBe("Mozilla/5.0 test");
    expect(evt.custom_data).toEqual({
      value: 99.99,
      currency: "USD",
      content_ids: ["sku-1", "sku-2"],
      transaction_id: "ord_1",
    });
    expect(body.test_event_code).toBeUndefined();
  });

  it("NEVER puts plaintext PII into the outbound payload", () => {
    const plaintextEmail = "plaintext-user@example.com";
    const plaintextPhone = "4155559999";
    const event = basePurchase({
      identity: { email: plaintextEmail, phone: plaintextPhone },
    });

    const body = buildMetaRequestBody({ event });
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain(plaintextEmail);
    expect(serialised).not.toContain(plaintextPhone);
    expect(body.data[0].user_data.em).toEqual([hashEmail(plaintextEmail)]);
    expect(body.data[0].user_data.ph).toEqual([hashPhone(plaintextPhone)]);
  });

  it("prefers a pre-hashed identity value over plaintext", () => {
    const preHashedEmail = "a".repeat(64);
    const event = basePurchase({
      identity: {
        email: "plaintext@example.com",
        email_sha256: preHashedEmail,
      },
    });

    const body = buildMetaRequestBody({ event });
    expect(body.data[0].user_data.em).toEqual([preHashedEmail]);
    expect(JSON.stringify(body)).not.toContain("plaintext@example.com");
  });

  it("appends test_event_code at the top level when provided", () => {
    const body = buildMetaRequestBody({
      event: basePurchase(),
      test_event_code: "TEST42",
    });
    expect(body.test_event_code).toBe("TEST42");
  });

  it("omits custom_data for page_view and user_identified", () => {
    const pageView: CanonicalEvent = {
      name: "page_view",
      event_id: EVENT_ID,
      journey_id: "j",
      visitor_id: "v",
      tenant_id: "t",
      ts: TS,
      props: { path: "/" },
    };
    const identified: CanonicalEvent = {
      name: "user_identified",
      event_id: EVENT_ID,
      journey_id: "j",
      visitor_id: "v",
      tenant_id: "t",
      ts: TS,
      props: {},
    };

    expect(buildMetaRequestBody({ event: pageView }).data[0].custom_data).toBeUndefined();
    expect(buildMetaRequestBody({ event: identified }).data[0].custom_data).toBeUndefined();
  });

  it("uses the item price for view_item / add_to_cart", () => {
    const view: CanonicalEvent = {
      name: "view_item",
      event_id: EVENT_ID,
      journey_id: "j",
      visitor_id: "v",
      tenant_id: "t",
      ts: TS,
      props: {
        item: { sku: "abc", quantity: 1, price_cents: 1234, currency: "EUR" },
      },
    };
    expect(buildMetaRequestBody({ event: view }).data[0].custom_data).toEqual({
      value: 12.34,
      currency: "EUR",
      content_ids: ["abc"],
    });
    expect(buildMetaRequestBody({ event: view }).data[0].event_name).toBe(
      "ViewContent",
    );
  });

  it("maps event names for every canonical variant", () => {
    const cases: Array<[CanonicalEvent["name"], string]> = [
      ["page_view", "PageView"],
      ["view_item", "ViewContent"],
      ["add_to_cart", "AddToCart"],
      ["begin_checkout", "InitiateCheckout"],
      ["user_identified", "CompleteRegistration"],
      ["purchase", "Purchase"],
    ];
    for (const [canonical, meta] of cases) {
      const event = buildEventOfKind(canonical);
      expect(buildMetaRequestBody({ event }).data[0].event_name).toBe(meta);
    }
  });
});

function buildEventOfKind(name: CanonicalEvent["name"]): CanonicalEvent {
  const base = {
    event_id: EVENT_ID,
    journey_id: "j",
    visitor_id: "v",
    tenant_id: "t",
    ts: TS,
  };
  const item = { sku: "s", quantity: 1, price_cents: 100, currency: "USD" };
  switch (name) {
    case "page_view":
      return { ...base, name, props: { path: "/" } };
    case "view_item":
      return { ...base, name, props: { item } };
    case "add_to_cart":
      return { ...base, name, props: { item } };
    case "begin_checkout":
      return {
        ...base,
        name,
        props: { items: [item], value_cents: 100, currency: "USD" },
      };
    case "user_identified":
      return { ...base, name, props: {} };
    case "purchase":
      return {
        ...base,
        name,
        props: {
          order_id: "o",
          items: [item],
          value_cents: 100,
          currency: "USD",
        },
      };
  }
}
