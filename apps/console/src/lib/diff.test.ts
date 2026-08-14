import { describe, expect, it } from "vitest";
import { diffAdded } from "./diff";

describe("diffAdded", () => {
  it("returns undefined when identical", () => {
    expect(diffAdded({ a: 1 }, { a: 1 })).toBeUndefined();
  });

  it("surfaces new top-level keys only", () => {
    const before = { event_id: "e1", name: "purchase" };
    const after = {
      event_id: "e1",
      name: "purchase",
      server: { fbc: "fb.1.2.abc", received_at: "2026-01-01" },
    };
    expect(diffAdded(before, after)).toEqual({
      server: { fbc: "fb.1.2.abc", received_at: "2026-01-01" },
    });
  });

  it("recurses into nested objects and only surfaces added subtree", () => {
    const before = { identity: { email: "u@x" } };
    const after = { identity: { email: "u@x", email_sha256: "abcd" } };
    expect(diffAdded(before, after)).toEqual({
      identity: { email_sha256: "abcd" },
    });
  });

  it("treats changed leaves as added", () => {
    expect(diffAdded({ x: 1 }, { x: 2 })).toEqual({ x: 2 });
  });

  it("does not surface removed fields", () => {
    // enriched dropped `a`; we only care about ADDED, not REMOVED.
    expect(diffAdded({ a: 1, b: 2 }, { b: 2 })).toBeUndefined();
  });
});
