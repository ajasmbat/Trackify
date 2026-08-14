import { describe, expect, it } from "vitest";
import {
  ALLOW_HEADERS,
  ALLOW_METHODS,
  computeCorsHeaders,
  isPreflight,
  MAX_AGE_SECONDS,
  pickAllowedOrigin,
} from "./cors";

describe("pickAllowedOrigin", () => {
  it("returns the exact origin when it appears in the allowlist", () => {
    expect(
      pickAllowedOrigin("https://shop.acme.test", [
        "https://shop.acme.test",
        "https://www.acme.test",
      ]),
    ).toBe("https://shop.acme.test");
  });

  it("returns undefined when the origin is not on the allowlist", () => {
    expect(
      pickAllowedOrigin("https://evil.example", ["https://shop.acme.test"]),
    ).toBeUndefined();
  });

  it("returns undefined when the origin is missing", () => {
    expect(
      pickAllowedOrigin(undefined, ["https://shop.acme.test"]),
    ).toBeUndefined();
  });

  it("never treats `*` as a wildcard", () => {
    expect(pickAllowedOrigin("https://evil.example", ["*"])).toBeUndefined();
    // A literal '*' Origin is not a real browser value and must not echo.
    expect(pickAllowedOrigin("*", ["https://shop.acme.test"])).toBeUndefined();
  });

  it("is case-sensitive and scheme-sensitive (does not match http vs https)", () => {
    expect(
      pickAllowedOrigin("http://shop.acme.test", ["https://shop.acme.test"]),
    ).toBeUndefined();
    expect(
      pickAllowedOrigin("https://SHOP.acme.test", ["https://shop.acme.test"]),
    ).toBeUndefined();
  });
});

describe("computeCorsHeaders", () => {
  it("returns the shared preflight fields plus the picked origin", () => {
    const h = computeCorsHeaders("https://shop.acme.test", [
      "https://shop.acme.test",
    ]);
    expect(h.allowOrigin).toBe("https://shop.acme.test");
    expect(h.vary).toBe("Origin");
    expect(h.allowMethods).toBe(ALLOW_METHODS);
    expect(h.allowHeaders).toBe(ALLOW_HEADERS);
    expect(h.maxAge).toBe(String(MAX_AGE_SECONDS));
  });

  it("omits allowOrigin when the origin is off-list", () => {
    const h = computeCorsHeaders("https://evil.example", [
      "https://shop.acme.test",
    ]);
    expect(h.allowOrigin).toBeUndefined();
    expect(h.allowMethods).toBe(ALLOW_METHODS);
  });

  it("allow methods = POST, OPTIONS; allow headers include content-type", () => {
    expect(ALLOW_METHODS).toBe("POST, OPTIONS");
    expect(ALLOW_HEADERS).toContain("content-type");
  });
});

describe("isPreflight", () => {
  it("is true only for OPTIONS + access-control-request-method", () => {
    expect(
      isPreflight("OPTIONS", { "access-control-request-method": "POST" }),
    ).toBe(true);
    expect(isPreflight("OPTIONS", {})).toBe(false);
    expect(
      isPreflight("POST", { "access-control-request-method": "POST" }),
    ).toBe(false);
  });
});
