import { describe, expect, it } from "vitest";
import { FBCLID_PATTERN, generateFbclid, generateGclid } from "./fbclid";

describe("generateFbclid", () => {
  it("starts with IwAR", () => {
    expect(generateFbclid().startsWith("IwAR")).toBe(true);
  });

  it("matches Meta's observed shape (base64url, 40 chars)", () => {
    const token = generateFbclid();
    expect(token).toHaveLength(40);
    expect(token).toMatch(FBCLID_PATTERN);
  });

  it("is unique across 1000 draws (entropy sanity)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateFbclid());
    expect(seen.size).toBe(1000);
  });
});

describe("generateGclid", () => {
  it("is url-safe base64 with reasonable length", () => {
    const token = generateGclid();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(38);
  });
});
