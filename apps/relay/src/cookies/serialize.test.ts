import { describe, expect, it } from "vitest";
import { formatSetCookie, parseCookieHeader } from "./serialize";

describe("parseCookieHeader", () => {
  it("returns an empty map for an undefined / empty header", () => {
    expect(parseCookieHeader(undefined).size).toBe(0);
    expect(parseCookieHeader("").size).toBe(0);
  });

  it("splits a multi-cookie header on ';' and trims whitespace", () => {
    const map = parseCookieHeader(" a=1;  b=two ; c=three ");
    expect(map.get("a")).toBe("1");
    expect(map.get("b")).toBe("two");
    expect(map.get("c")).toBe("three");
  });

  it("URL-decodes values", () => {
    expect(parseCookieHeader("greeting=hello%20world").get("greeting")).toBe(
      "hello world",
    );
  });

  it("ignores entries with no '=' separator", () => {
    expect(parseCookieHeader("legit=1; garbage; other=2").size).toBe(2);
  });
});

describe("formatSetCookie", () => {
  it("emits the plan's canonical attribute set for rly_vid", () => {
    const cookie = formatSetCookie("rly_vid", "abcXYZ", {
      path: "/",
      maxAgeSeconds: 63_072_000,
      secure: true,
      httpOnly: true,
      sameSite: "None",
      partitioned: true,
    });
    expect(cookie).toBe(
      "rly_vid=abcXYZ; Path=/; Max-Age=63072000; SameSite=None; Secure; HttpOnly; Partitioned",
    );
  });

  it("prepends Domain when set", () => {
    const cookie = formatSetCookie("x", "v", {
      domain: "data.acme.test",
      path: "/",
      secure: true,
    });
    expect(cookie.startsWith("x=v; Domain=data.acme.test; Path=/")).toBe(true);
  });

  it("percent-encodes the value so a ';' inside can't break the header", () => {
    const cookie = formatSetCookie("x", "hi;there=", { path: "/" });
    expect(cookie).toBe("x=hi%3Bthere%3D; Path=/");
  });

  it("omits HttpOnly / Secure / Partitioned when the flags are false", () => {
    const cookie = formatSetCookie("x", "v", { path: "/" });
    expect(cookie).toBe("x=v; Path=/");
  });
});
