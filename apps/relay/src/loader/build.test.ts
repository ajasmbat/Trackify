import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  DEFAULT_ENDPOINT,
  DEFAULT_JOURNEY_COOKIE,
  DEFAULT_VISITOR_COOKIE,
} from "./build";
import {
  SLOT_HOST,
  SLOT_TENANT_ID,
  SLOT_EP,
  SLOT_JID_COOKIE,
  SLOT_VID_COOKIE,
} from "./template";

const HOST = "https://data.acme.dev";
const TID = "tenant-acme-uuid";

describe("buildSnippet — template substitution", () => {
  it("substitutes tenant id, host, endpoint, and cookie names", () => {
    const src = buildSnippet({ tenantId: TID, host: HOST });
    expect(src).toContain(JSON.stringify(TID));
    expect(src).toContain(JSON.stringify(HOST));
    expect(src).toContain(JSON.stringify(DEFAULT_ENDPOINT));
    expect(src).toContain(JSON.stringify(DEFAULT_JOURNEY_COOKIE));
    expect(src).toContain(JSON.stringify(DEFAULT_VISITOR_COOKIE));
  });

  it("leaves no unsubstituted slot tokens in the emitted bytes", () => {
    const src = buildSnippet({ tenantId: TID, host: HOST });
    for (const slot of [
      SLOT_TENANT_ID,
      SLOT_HOST,
      SLOT_EP,
      SLOT_JID_COOKIE,
      SLOT_VID_COOKIE,
    ]) {
      expect(src).not.toContain(slot);
    }
  });

  it("strips a trailing slash off the host so the assembled URL has no double slash", () => {
    const withSlash = buildSnippet({ tenantId: TID, host: `${HOST}///` });
    expect(withSlash).toContain(JSON.stringify(HOST));
    expect(withSlash).not.toContain(`${HOST}//`);
  });

  it("respects an override endpoint + cookie names", () => {
    const src = buildSnippet({
      tenantId: TID,
      host: HOST,
      endpoint: "q",
      journeyCookie: "jj",
      visitorCookie: "vv",
    });
    expect(src).toContain('"q"');
    expect(src).toContain('"jj"');
    expect(src).toContain('"vv"');
  });
});

describe("buildSnippet — ad-block resistance", () => {
  const src = buildSnippet({ tenantId: TID, host: HOST });

  // Each of these substrings would let a filter list catch the snippet by
  // static content. The whole point of the loader is that none of them
  // appear in the emitted bytes.
  for (const forbidden of [
    "POST /e",
    "facebook",
    "fbq",
    "_fbc",
    "pixel",
    "fbevents",
  ]) {
    it(`does not contain the literal ${JSON.stringify(forbidden)}`, () => {
      expect(src).not.toContain(forbidden);
    });
  }

  it("does not embed the ingest URL literal — `host + \"/\" + endpoint` is assembled at runtime", () => {
    // The full URL (host + "/" + endpoint) must not appear as a single
    // literal in the source; the snippet assembles it from three locals.
    expect(src).not.toContain(`${HOST}/${DEFAULT_ENDPOINT}`);
  });

  it("keeps identifier names short and semantically opaque", () => {
    // A rough smell-check — none of the JS names we emit should betray
    // their purpose to a lexer looking for tracking-shaped code.
    for (const banned of ["trackEvent", "sendEvent", "trackify_send"]) {
      expect(src).not.toContain(banned);
    }
  });
});

describe("buildSnippet — behavioural surface", () => {
  const src = buildSnippet({ tenantId: TID, host: HOST });

  it("mirrors T8's canonical event names in the discriminated union", () => {
    for (const name of [
      "page_view",
      "view_item",
      "add_to_cart",
      "begin_checkout",
      "user_identified",
      "purchase",
    ]) {
      expect(src).toContain(name);
    }
  });

  it("uses sendBeacon for unload-safe events (purchase, begin_checkout)", () => {
    expect(src).toContain("sendBeacon");
    // Both unload-safe names must be enumerated in the emitted array.
    expect(src).toMatch(/purchase.*begin_checkout|begin_checkout.*purchase/);
  });

  it("emits an event_id and reads/writes journey + visitor cookies", () => {
    expect(src).toContain("event_id");
    expect(src).toContain("journey_id");
    expect(src).toContain("visitor_id");
    expect(src).toContain(DEFAULT_JOURNEY_COOKIE);
    expect(src).toContain(DEFAULT_VISITOR_COOKIE);
  });

  it("does not attempt to hash PII on the client — hashing is the relay's job", () => {
    // If someone ever reaches for crypto.subtle to hash email/phone in the
    // snippet, the whole PII-normalisation-lives-server-side contract breaks.
    expect(src).not.toContain("crypto.subtle");
    expect(src).not.toContain("digest");
  });
});
