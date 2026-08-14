import { describe, expect, it } from "vitest";
import { deriveFbc, readFbcCookie, readFbclidFromUrl } from "./fbc";

describe("deriveFbc", () => {
  it("returns the cookie value when one is present", () => {
    expect(
      deriveFbc({
        cookieFbc: "fb.1.111.EXISTING",
        fbclid: "IGNORED",
        now: 999,
      }),
    ).toBe("fb.1.111.EXISTING");
  });

  it("derives fb.1.{now}.{fbclid} when the cookie is missing", () => {
    expect(deriveFbc({ fbclid: "abc123", now: 1_700_000_000_000 })).toBe(
      "fb.1.1700000000000.abc123",
    );
  });

  it("returns undefined when both cookie and fbclid are missing", () => {
    expect(deriveFbc({ now: 1 })).toBeUndefined();
  });

  it("ignores an empty cookie value", () => {
    expect(deriveFbc({ cookieFbc: "  ", fbclid: "abc", now: 42 })).toBe(
      "fb.1.42.abc",
    );
  });
});

describe("readFbcCookie", () => {
  it("finds _fbc in a multi-cookie header", () => {
    expect(
      readFbcCookie("_ga=x; _fbc=fb.1.111.CLICK; _fbp=fb.1.222.XYZ"),
    ).toBe("fb.1.111.CLICK");
  });

  it("returns undefined when _fbc is absent", () => {
    expect(readFbcCookie("_ga=x; _fbp=y")).toBeUndefined();
  });

  it("returns undefined for missing cookie header", () => {
    expect(readFbcCookie(undefined)).toBeUndefined();
  });
});

describe("readFbclidFromUrl", () => {
  it("pulls fbclid from the query string", () => {
    expect(
      readFbclidFromUrl("https://shop.acme.test/?fbclid=abc123&utm=meta"),
    ).toBe("abc123");
  });

  it("returns undefined when fbclid is absent", () => {
    expect(readFbclidFromUrl("https://shop.acme.test/")).toBeUndefined();
  });

  it("returns undefined for a malformed url", () => {
    expect(readFbclidFromUrl("not a url")).toBeUndefined();
  });
});
