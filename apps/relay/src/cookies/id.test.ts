import { describe, expect, it } from "vitest";
import { newRelayVisitorId } from "./id";

describe("newRelayVisitorId", () => {
  it("returns 32 URL-safe base64 characters (24 bytes of entropy)", () => {
    const id = newRelayVisitorId();
    expect(id).toMatch(/^[A-Za-z0-9\-_]{32}$/);
  });

  it("never reuses a value across 1_000 calls (cookie contract: unique per visitor)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) seen.add(newRelayVisitorId());
    expect(seen.size).toBe(1_000);
  });
});
