import { describe, expect, it } from "vitest";
import { normalizeHost, TenantNotFoundError } from "./resolve";

describe("normalizeHost", () => {
  it("returns undefined for empty / undefined input", () => {
    expect(normalizeHost(undefined)).toBeUndefined();
    expect(normalizeHost("")).toBeUndefined();
    expect(normalizeHost("   ")).toBeUndefined();
  });

  it("strips an explicit port and lowercases", () => {
    expect(normalizeHost("shop.acme.test")).toBe("shop.acme.test");
    expect(normalizeHost("shop.acme.test:8443")).toBe("shop.acme.test");
    expect(normalizeHost("Shop.Acme.Test")).toBe("shop.acme.test");
  });
});

describe("TenantNotFoundError", () => {
  it("carries a typed code and the offending host", () => {
    const err = new TenantNotFoundError("unknown.test");
    expect(err.code).toBe("tenant_not_found");
    expect(err.host).toBe("unknown.test");
    expect(err.message).toContain("unknown.test");
    expect(err instanceof Error).toBe(true);
  });
});
