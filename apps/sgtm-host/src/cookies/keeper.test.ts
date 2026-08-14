// Pin CREDENTIAL_KEY_HEX BEFORE importing anything that transitively loads
// packages/db/src/crypto — that module reads process.env at first use, and
// its own env schema demands the key exists. Ambient shell env may or may
// not have it, so this suite must own the key.
process.env.CREDENTIAL_KEY_HEX ??=
  "0000000000000000000000000000000000000000000000000000000000000000";

import { describe, expect, it } from "vitest";
import {
  isRewrittenName,
  restoreCookieHeader,
  rewriteSetCookies,
  rewrittenName,
} from "./keeper";

describe("keeper — rewrittenName", () => {
  it("is deterministic (same input → same output)", () => {
    expect(rewrittenName("_ga")).toBe(rewrittenName("_ga"));
    expect(rewrittenName("FPID")).toBe(rewrittenName("FPID"));
  });

  it("uses the sgtm_ prefix and a 12-char base32-lower hash", () => {
    const name = rewrittenName("_ga");
    expect(name.startsWith("sgtm_")).toBe(true);
    // Prefix (5) + 12 hash chars.
    expect(name.length).toBe(5 + 12);
    expect(name.slice(5)).toMatch(/^[a-z2-7]{12}$/);
  });

  it("distinguishes different cookie names", () => {
    expect(rewrittenName("_ga")).not.toBe(rewrittenName("_gid"));
  });
});

describe("keeper — rewriteSetCookies (outbound)", () => {
  it("wraps a plain cookie in HttpOnly/Secure/SameSite=None/Partitioned + 2yr Max-Age", async () => {
    const [out] = await rewriteSetCookies(["_ga=GA1.2.abcdef; Path=/"]);
    expect(out).toBeDefined();
    const line = out ?? "";
    const [head] = line.split(";");
    const name = head?.split("=")[0]?.trim() ?? "";
    expect(name).toBe(rewrittenName("_ga"));
    expect(line).toContain("HttpOnly");
    expect(line).toContain("Secure");
    expect(line).toContain("SameSite=None");
    expect(line).toContain("Partitioned");
    expect(line).toContain("Max-Age=63072000");
    expect(line).toContain("Path=/");
  });

  it("preserves multiple cookies as separate rewritten headers", async () => {
    const out = await rewriteSetCookies([
      "_ga=v1; Path=/",
      "_gid=v2; Path=/",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.startsWith(`${rewrittenName("_ga")}=`)).toBe(true);
    expect(out[1]?.startsWith(`${rewrittenName("_gid")}=`)).toBe(true);
  });

  it("propagates Max-Age=0 deletes on the rewritten name", async () => {
    const [out] = await rewriteSetCookies([
      "_ga=deleted; Path=/; Max-Age=0",
    ]);
    expect(out).toContain(`${rewrittenName("_ga")}=;`);
    expect(out).toContain("Max-Age=0");
  });

  it("propagates past-Expires deletes on the rewritten name", async () => {
    const [out] = await rewriteSetCookies([
      "_ga=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    expect(out).toContain(`${rewrittenName("_ga")}=;`);
    expect(out).toContain("Max-Age=0");
  });

  it("skips reserved-namespace cookies (sgtm_ prefix) — idempotent", async () => {
    const [out] = await rewriteSetCookies([
      "sgtm_alreadywrapped=abc; Path=/",
    ]);
    // Passes through unchanged — no re-wrap.
    expect(out).toBe("sgtm_alreadywrapped=abc; Path=/");
  });
});

describe("keeper — restoreCookieHeader (inbound)", () => {
  it("round-trips sealed cookies back to their original name and value", async () => {
    const [sealed] = await rewriteSetCookies(["_ga=GA1.2.abcdef; Path=/"]);
    const pair = sealed?.split(";")[0] ?? "";
    expect(pair).not.toBe("");
    const restored = await restoreCookieHeader(pair);
    expect(restored).toBe("_ga=GA1.2.abcdef");
  });

  it("strips tampered sealed cookies", async () => {
    const [sealed] = await rewriteSetCookies(["_ga=GA1.2.abcdef; Path=/"]);
    const pair = sealed?.split(";")[0] ?? "";
    const [name, value = ""] = pair.split("=", 2);
    // Flip a byte of the sealed payload — auth tag mismatch → unseal returns null.
    const tampered = `${name}=${value.slice(0, -2)}AA`;
    const restored = await restoreCookieHeader(tampered);
    expect(restored).toBe("");
  });

  it("leaves non-sealed cookies untouched", async () => {
    const restored = await restoreCookieHeader("session=abc; other=def");
    expect(restored).toBe("session=abc; other=def");
  });

  it("restores sealed cookies alongside untouched ones in one header", async () => {
    const [sealed] = await rewriteSetCookies(["_ga=v; Path=/"]);
    const pair = sealed?.split(";")[0] ?? "";
    const restored = await restoreCookieHeader(`session=abc; ${pair}`);
    expect(restored).toBe("session=abc; _ga=v");
  });
});

describe("keeper — isRewrittenName", () => {
  it("recognizes the sgtm_ prefix", () => {
    expect(isRewrittenName("sgtm_abc123")).toBe(true);
    expect(isRewrittenName("_ga")).toBe(false);
  });
});
