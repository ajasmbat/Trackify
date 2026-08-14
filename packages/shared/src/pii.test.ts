import { describe, expect, it } from "vitest";
import {
  hashEmail,
  hashPhone,
  normaliseEmail,
  normalisePhone,
  sha256Hex,
} from "./pii";

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Foo@Bar.COM  ")).toBe("foo@bar.com");
  });
});

describe("normalisePhone", () => {
  it("strips non-digits", () => {
    expect(normalisePhone("+1 (415) 555-1234")).toBe("14155551234");
    expect(normalisePhone("415.555.1234")).toBe("4155551234");
  });
});

describe("sha256Hex", () => {
  it("matches the RFC test vector for the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("matches the RFC test vector for 'abc'", () => {
    // Canonical NIST FIPS-180-4 test vector for SHA-256("abc").
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("hashEmail", () => {
  it("normalises then hashes so equivalent casings collide", () => {
    expect(hashEmail("Foo@Bar.COM")).toBe(hashEmail("foo@bar.com"));
    expect(hashEmail("foo@bar.com")).toBe(sha256Hex("foo@bar.com"));
  });
});

describe("hashPhone", () => {
  it("normalises then hashes so equivalent formats collide", () => {
    expect(hashPhone("+1 (415) 555-1234")).toBe(hashPhone("14155551234"));
    expect(hashPhone("14155551234")).toBe(sha256Hex("14155551234"));
  });
});
