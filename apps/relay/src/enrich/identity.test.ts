import { describe, expect, it } from "vitest";
import type { CanonicalEvent } from "@trackify/shared";
import { mergeStoredIdentity } from "./identity";
import type { StoredIdentity } from "./store";

function pageView(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    event_id: "11111111-1111-1111-1111-111111111111",
    journey_id: "j-1",
    visitor_id: "v-abc",
    tenant_id: "t-1",
    ts: "2026-08-14T00:00:00.000Z",
    name: "page_view",
    props: { path: "/" },
    ...overrides,
  } as CanonicalEvent;
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("mergeStoredIdentity — pure transform", () => {
  it("no stored → event unchanged (identity remains undefined)", () => {
    const event = pageView();
    const out = mergeStoredIdentity(event, null);
    expect(out).toBe(event);
    expect(out.identity).toBeUndefined();
  });

  it("empty stored ({}) is treated as null — no mutation", () => {
    const event = pageView();
    const out = mergeStoredIdentity(event, {} as StoredIdentity);
    // filterNonEmpty happens at the store; but mergeStoredIdentity should also
    // be a no-op on an empty identity because no fields to copy.
    expect(out).toEqual(event);
    expect(out.identity).toBeUndefined();
  });

  it("attaches all three stored fields to an anonymous event", () => {
    const event = pageView();
    const stored: StoredIdentity = {
      email_sha256: HASH_A,
      phone_sha256: HASH_B,
      external_id_sha256: HASH_C,
    };
    const out = mergeStoredIdentity(event, stored);
    expect(out.identity).toEqual(stored);
  });

  it("inbound wins — pre-existing hashed field is not overwritten", () => {
    const clientEmail = "d".repeat(64);
    const event = pageView({ identity: { email_sha256: clientEmail } });
    const out = mergeStoredIdentity(event, {
      email_sha256: HASH_A,
      phone_sha256: HASH_B,
    });
    expect(out.identity?.email_sha256).toBe(clientEmail);
    expect(out.identity?.phone_sha256).toBe(HASH_B);
  });

  it("inbound plaintext also blocks stored — either presence counts", () => {
    // Precondition: T4 has already hashed. But if for some reason a
    // downstream test injected raw email, the merge must still treat it as
    // "identity present" — otherwise we would ship two contradictory emails.
    const event = pageView({ identity: { email: "already@here.test" } });
    const out = mergeStoredIdentity(event, { email_sha256: HASH_A });
    expect(out.identity?.email_sha256).toBeUndefined();
    expect(out.identity?.email).toBe("already@here.test");
  });

  it("returns the same reference when nothing changes (no wasted copies)", () => {
    const event = pageView({
      identity: {
        email_sha256: HASH_A,
        phone_sha256: HASH_B,
        external_id_sha256: HASH_C,
      },
    });
    const out = mergeStoredIdentity(event, {
      email_sha256: HASH_A,
      phone_sha256: HASH_B,
      external_id_sha256: HASH_C,
    });
    expect(out).toBe(event);
  });

  it("does not mutate the input event", () => {
    const event = pageView();
    const frozen = structuredClone(event);
    mergeStoredIdentity(event, { email_sha256: HASH_A });
    expect(event).toEqual(frozen);
  });
});
