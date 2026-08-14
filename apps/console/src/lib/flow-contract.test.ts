import { describe, expect, it } from "vitest";
import type { EventDetail } from "./queries";
import { evaluateJourney, HOPS } from "./flow-contract";

// Small factory — produces a plausible EventDetail with the right shape and
// lets each test override just the fields that matter for the hop it exercises.
function ev(over: Partial<EventDetail> & { name: string }): EventDetail {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: over.id ?? `id-${over.name}-${Math.random().toString(36).slice(2, 8)}`,
    eventId: over.eventId ?? "11111111-1111-1111-1111-111111111111",
    tenantId: over.tenantId ?? "t1",
    visitorId: over.visitorId ?? "v1",
    journeyId: over.journeyId ?? "j1",
    name: over.name,
    ts: over.ts ?? now,
    receivedAt: over.receivedAt ?? now,
    inboundPayload: over.inboundPayload ?? {},
    outboundPerDestination: over.outboundPerDestination ?? {},
    deliveries: over.deliveries ?? [],
  };
}

describe("flow-contract", () => {
  it("exposes exactly 7 hops in numerical order", () => {
    expect(HOPS.map((h) => h.hop)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("empty journey fails every stage; hops 5 and 6 are ERROR (RED)", () => {
    const result = evaluateJourney([]);
    expect(result.every((r) => !r.result.ok)).toBe(true);
    expect(result.find((r) => r.hop === 5)?.result.severity).toBe("error");
    expect(result.find((r) => r.hop === 6)?.result.severity).toBe("error");
  });

  it("hop 5 is RED when no event carries server.fbc", () => {
    const events = [
      ev({ name: "page_view", inboundPayload: { server: {} } }),
      ev({ name: "purchase", inboundPayload: { server: { fbclid: "IwARabc" } } }),
    ];
    const result = evaluateJourney(events);
    const h5 = result.find((r) => r.hop === 5)!;
    expect(h5.result.ok).toBe(false);
    expect(h5.result.severity).toBe("error");
    expect(h5.result.observed).toMatch(/no event has server.fbc/);
  });

  it("hop 5 passes when at least one event has server.fbc", () => {
    const events = [
      ev({
        name: "purchase",
        inboundPayload: { server: { fbc: "fb.1.2.abc" } },
      }),
    ];
    const h5 = evaluateJourney(events).find((r) => r.hop === 5)!;
    expect(h5.result.ok).toBe(true);
    expect(h5.result.severity).toBe("info");
    expect(h5.result.supportingEventIds).toHaveLength(1);
  });

  it("hop 6 is RED when no event carries a *_sha256 identity", () => {
    const events = [ev({ name: "purchase", inboundPayload: { identity: {} } })];
    const h6 = evaluateJourney(events).find((r) => r.hop === 6)!;
    expect(h6.result.ok).toBe(false);
    expect(h6.result.severity).toBe("error");
  });

  it("hop 6 passes with a hashed email OR phone OR external_id", () => {
    const events = [
      ev({
        name: "purchase",
        inboundPayload: { identity: { email_sha256: "a".repeat(64) } },
      }),
    ];
    const h6 = evaluateJourney(events).find((r) => r.hop === 6)!;
    expect(h6.result.ok).toBe(true);
  });

  it("hop 7 passes when at least one delivery has status='done'", () => {
    const events = [
      ev({
        name: "purchase",
        deliveries: [
          {
            id: "d1",
            destinationId: "dest1",
            destinationProvider: "meta",
            status: "done",
            attempts: 1,
            lastError: null,
            outboundPayload: { ok: true },
            createdAt: new Date(),
            nextAttemptAt: new Date(),
            completedAt: new Date(),
          },
        ],
      }),
    ];
    const h7 = evaluateJourney(events).find((r) => r.hop === 7)!;
    expect(h7.result.ok).toBe(true);
  });

  it("hop 7 flags dead-letter with severity=error", () => {
    const events = [
      ev({
        name: "purchase",
        deliveries: [
          {
            id: "d1",
            destinationId: "dest1",
            destinationProvider: "meta",
            status: "dead_letter",
            attempts: 5,
            lastError: "permanent: invalid pixel",
            outboundPayload: {},
            createdAt: new Date(),
            nextAttemptAt: new Date(),
            completedAt: new Date(),
          },
        ],
      }),
    ];
    const h7 = evaluateJourney(events).find((r) => r.hop === 7)!;
    expect(h7.result.ok).toBe(false);
    expect(h7.result.severity).toBe("error");
  });
});
