import { describe, expect, it } from "vitest";
import { hashEmail, hashPhone, sha256Hex } from "@trackify/shared";
import { InvalidPhoneError, hashIdentity } from "./hash";

describe("hashIdentity", () => {
  it("returns undefined for undefined input", () => {
    expect(hashIdentity(undefined)).toBeUndefined();
  });

  it("hashes raw email through the shared helper", () => {
    const out = hashIdentity({ email: "Foo@Bar.COM" });
    expect(out).toEqual({ email_sha256: hashEmail("foo@bar.com") });
  });

  it("hashes raw phone through the shared helper", () => {
    const out = hashIdentity({ phone: "+1 (415) 555-1234" });
    expect(out).toEqual({ phone_sha256: hashPhone("14155551234") });
  });

  it("hashes raw external_id", () => {
    const out = hashIdentity({ external_id: "user-42" });
    expect(out).toEqual({ external_id_sha256: sha256Hex("user-42") });
  });

  it("passes an already-hashed value through unchanged", () => {
    const preHash = sha256Hex("foo@bar.com");
    expect(hashIdentity({ email_sha256: preHash })).toEqual({
      email_sha256: preHash,
    });
  });

  it("prefers an existing hash over the raw value", () => {
    const preHash = "a".repeat(64);
    const out = hashIdentity({ email: "foo@bar.com", email_sha256: preHash });
    expect(out).toEqual({ email_sha256: preHash });
  });

  it("throws when phone is present but normalises to empty", () => {
    expect(() => hashIdentity({ phone: "not-a-number" })).toThrow(
      InvalidPhoneError,
    );
  });

  it("hashes email + phone + external_id together", () => {
    const out = hashIdentity({
      email: "foo@bar.com",
      phone: "14155551234",
      external_id: "user-42",
    });
    expect(out).toEqual({
      email_sha256: hashEmail("foo@bar.com"),
      phone_sha256: hashPhone("14155551234"),
      external_id_sha256: sha256Hex("user-42"),
    });
  });
});
