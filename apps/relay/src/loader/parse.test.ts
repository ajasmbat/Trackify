import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { buildSnippet } from "./build";

// A last-line-of-defence check that the emitted bytes are syntactically
// valid JavaScript. The template hand-writes short one-char identifiers and
// concatenated string builders — the easiest way for a regression to slip
// past unit-shape assertions is a syntax error that only appears at parse
// time. Compiling under `vm` catches that without executing the code.

describe("emitted snippet parses as valid JavaScript", () => {
  it("parses without throwing (Node's V8 parser)", () => {
    const src = buildSnippet({
      tenantId: "tenant-uuid",
      host: "https://data.acme.dev",
    });
    expect(() => new vm.Script(src)).not.toThrow();
  });

  it("evaluates in a browser-shaped sandbox and installs the __tf global", () => {
    const src = buildSnippet({
      tenantId: "tenant-uuid",
      host: "https://data.acme.dev",
    });
    const fetches: Array<{ url: string; body: string }> = [];
    const sandbox: Record<string, unknown> = {};
    // Minimal shims — the snippet only needs these globals for the
    // page_view auto-fire path to run to completion. Anything richer
    // (SPA push-state hooks, sendBeacon fallbacks) would need extras.
    sandbox.window = sandbox;
    sandbox.document = {
      cookie: "",
      readyState: "complete",
      referrer: "",
      addEventListener: () => {},
    };
    sandbox.navigator = { userAgent: "vitest", language: "en" };
    sandbox.crypto = {
      getRandomValues(u: Uint8Array) {
        for (let i = 0; i < u.length; i++) u[i] = i;
        return u;
      },
    };
    sandbox.location = { href: "https://shop.acme.dev/", pathname: "/" };
    sandbox.history = {};
    sandbox.btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
    sandbox.fetch = (url: string, init?: { body?: string }) => {
      fetches.push({ url, body: String(init?.body ?? "") });
      return Promise.resolve();
    };
    sandbox.Blob = class {
      readonly parts: unknown[];
      constructor(parts: unknown[]) {
        this.parts = parts;
      }
    } as unknown;

    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);

    const tf = sandbox.__tf as { t: (n: string, p: Record<string, unknown>) => string } | undefined;
    expect(tf).toBeTruthy();
    expect(typeof tf?.t).toBe("function");

    // Auto-fired page_view should have hit fetch already.
    expect(fetches.length).toBe(1);
    expect(fetches[0]?.url).toBe("https://data.acme.dev/e");
    const parsed = JSON.parse(fetches[0]?.body ?? "{}");
    expect(parsed.events?.[0]?.name).toBe("page_view");
    expect(parsed.events?.[0]?.tenant_id).toBe("tenant-uuid");
    expect(typeof parsed.events?.[0]?.event_id).toBe("string");
    expect(parsed.events?.[0]?.event_id).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
