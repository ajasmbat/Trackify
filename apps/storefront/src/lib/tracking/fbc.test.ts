import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFbc, captureClickParams, readFbc, readFbp, readGclAw } from "./fbc";
import { type TrackingTestDom, installTestDom } from "./test-dom";

// The server-side `_fbc` derivation lives at apps/relay/src/ingest/fbc.ts and
// its documented rule is `fb.1.{ts}.{fbclid}`. We assert against the literal
// shape here rather than importing across app boundaries; the relay's own
// tests keep the server side honest to the same rule.
function serverDerivedFbc(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

let dom: TrackingTestDom;

beforeEach(() => {
  dom = installTestDom({ href: "https://shop.example.test/" });
});

afterEach(() => {
  dom.restore();
});

// The client-side `_fbc` writer MUST agree with the server-side derivation
// in apps/relay/src/ingest/fbc.ts — otherwise the browser and CAPI signals
// would disagree on the same click and Meta's dedup would break.
describe("client / server fbc parity", () => {
  it("client `buildFbc` matches the documented `fb.1.{ts}.{fbclid}` shape", () => {
    const now = 1_734_567_890_123;
    const fbclid = `IwAR${"abcdef".repeat(6)}`;
    expect(buildFbc(fbclid, now)).toBe(serverDerivedFbc(fbclid, now));
  });

  it("captured `_fbc` cookie has the exact server-derived shape", () => {
    const now = 1_700_000_000_000;
    const fbclid = "IwAR-test-value";
    dom.restore();
    dom = installTestDom({ href: `https://shop.example.test/?fbclid=${fbclid}` });
    captureClickParams({ url: `https://shop.example.test/?fbclid=${fbclid}`, nowMs: now });
    expect(readFbc()).toBe(serverDerivedFbc(fbclid, now));
  });
});

describe("captureClickParams", () => {
  it("writes _fbc when fbclid is in the URL and no cookie exists", () => {
    dom.restore();
    dom = installTestDom({ href: "https://shop.example.test/?fbclid=abc123" });
    captureClickParams({ url: "https://shop.example.test/?fbclid=abc123", nowMs: 111 });
    expect(readFbc()).toBe("fb.1.111.abc123");
  });

  it("does not clobber an existing _fbc cookie (visitor was tagged earlier)", () => {
    dom.restore();
    dom = installTestDom({
      href: "https://shop.example.test/?fbclid=new-click",
      cookie: "_fbc=fb.1.999.original",
    });
    captureClickParams({ url: "https://shop.example.test/?fbclid=new-click", nowMs: 222 });
    expect(readFbc()).toBe("fb.1.999.original");
  });

  it("captures gclid into _gcl_aw when present", () => {
    dom.restore();
    dom = installTestDom({ href: "https://shop.example.test/?gclid=g-123" });
    captureClickParams({ url: "https://shop.example.test/?gclid=g-123", nowMs: 555 });
    expect(readGclAw()).toBe("GCL.555.g-123");
  });

  it("mints _fbp when absent so events fired pre-pixel still carry a browser id", () => {
    captureClickParams({ url: "https://shop.example.test/", nowMs: 777, rng: () => 0.5 });
    expect(readFbp()).toBe("fb.1.777.5000000000");
  });

  it("leaves _fbp alone when the cookie already exists", () => {
    dom.restore();
    dom = installTestDom({
      href: "https://shop.example.test/",
      cookie: "_fbp=fb.1.100.abc",
    });
    captureClickParams({ url: "https://shop.example.test/", nowMs: 999 });
    expect(readFbp()).toBe("fb.1.100.abc");
  });
});
