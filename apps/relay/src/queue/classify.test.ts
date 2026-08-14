import { describe, expect, it } from "vitest";
import type { SendResult } from "@trackify/shared";
import { classify } from "./classify";

describe("classify", () => {
  it("`ok` → done", () => {
    const result: SendResult = { kind: "ok", outbound_payload: { any: 1 } };
    expect(classify(result)).toEqual({ outcome: "done" });
  });

  it("`transient_failure` → retry (network / 5xx / 429 all funnel through this arm)", () => {
    const httpTransient: SendResult = {
      kind: "transient_failure",
      status: 429,
      reason: "rate limited",
      outbound_payload: null,
    };
    expect(classify(httpTransient)).toEqual({
      outcome: "retry",
      status: 429,
      reason: "rate limited",
    });

    const fiveHundred: SendResult = {
      kind: "transient_failure",
      status: 503,
      reason: "gateway",
      outbound_payload: null,
    };
    expect(classify(fiveHundred).outcome).toBe("retry");

    const networkError: SendResult = {
      kind: "transient_failure",
      reason: "ECONNRESET",
      outbound_payload: null,
    };
    expect(classify(networkError).outcome).toBe("retry");
  });

  it("`permanent_failure` → permanent (never retried, reason preserved)", () => {
    const badRequest: SendResult = {
      kind: "permanent_failure",
      status: 400,
      reason: "invalid_event_id",
      outbound_payload: { event_id: null },
    };
    expect(classify(badRequest)).toEqual({
      outcome: "permanent",
      status: 400,
      reason: "invalid_event_id",
    });

    const forbidden: SendResult = {
      kind: "permanent_failure",
      status: 403,
      reason: "bad credentials",
      outbound_payload: null,
    };
    expect(classify(forbidden).outcome).toBe("permanent");
  });
});
