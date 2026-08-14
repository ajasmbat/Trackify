import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, loadBaseTemplate } from "./render";
import { ContainerConfig } from "./schema";
import { DEFAULT_FIELD_MAP } from "./field-map";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");

const VALID_INPUT = {
  gtmContainerId: "GTM-ABCDE12",
  meta: {
    pixelId: "111111111111111",
    accessToken: "TOK",
  },
} as const;

describe("base-container.json", () => {
  it("parses as JSON", () => {
    expect(() => JSON.parse(loadBaseTemplate())).not.toThrow();
  });

  it("template body validates against the container_config schema (with placeholders in place)", () => {
    // We can't parse the raw template through the schema because the
    // placeholders substitute inside numeric slots; but the top-level shape
    // must already conform (exportFormatVersion, containerVersion.tag, etc.).
    const parsed = JSON.parse(loadBaseTemplate()) as unknown;
    expect(() => ContainerConfig.parse(parsed)).not.toThrow();
  });

  it("declares one client for /data, at least one Meta tag, and one GA4 tag", () => {
    const parsed = JSON.parse(loadBaseTemplate()) as {
      containerVersion: {
        client: Array<{ name: string; parameter: Array<{ key: string; value?: string }> }>;
        tag: Array<{ name: string; type: string }>;
      };
    };
    const client = parsed.containerVersion.client[0];
    expect(client?.name).toBe("Trackify Data Client");
    const requestPath = client?.parameter.find((p) => p.key === "requestPath");
    expect(requestPath?.value).toBe("/data");
    const tagNames = parsed.containerVersion.tag.map((t) => t.name);
    expect(tagNames).toContain("Meta Conversions API");
    expect(tagNames).toContain("Google Analytics 4");
  });
});

describe("render()", () => {
  it("returns a json string, a base64 string, and a parsed config", () => {
    const result = render(VALID_INPUT);
    expect(typeof result.json).toBe("string");
    expect(typeof result.base64).toBe("string");
    expect(result.config.exportFormatVersion).toBe(2);
    // Round-trip: base64 decodes to the same JSON.
    const decoded = Buffer.from(result.base64, "base64").toString("utf8");
    expect(decoded).toBe(result.json);
    expect(JSON.parse(decoded)).toEqual(result.config);
  });

  it("substitutes the pixel id, access token, and GTM container id into the tag parameters", () => {
    const result = render({
      gtmContainerId: "GTM-XYZ99",
      meta: { pixelId: "PXL", accessToken: "TOK-SECRET" },
    });
    const metaTag = result.config.containerVersion.tag.find(
      (t) => t.name === "Meta Conversions API",
    );
    expect(metaTag).toBeDefined();
    const params = new Map<string, string | undefined>(
      metaTag!.parameter!.map((p) => [p.key, p.value]),
    );
    expect(params.get("pixelId")).toBe("PXL");
    expect(params.get("accessToken")).toBe("TOK-SECRET");
    expect(result.config.containerVersion.container.publicId).toBe("GTM-XYZ99");
  });

  it("leaves GA4 disabled and blank when no ga4 credentials are provided", () => {
    const result = render(VALID_INPUT);
    const ga4Tag = result.config.containerVersion.tag.find(
      (t) => t.name === "Google Analytics 4",
    );
    const params = new Map<string, string | undefined>(
      ga4Tag!.parameter!.map((p) => [p.key, p.value]),
    );
    expect(params.get("enabled")).toBe("false");
    expect(params.get("measurementId")).toBe("");
    expect(params.get("apiSecret")).toBe("");
  });

  it("flips GA4 to enabled when ga4 credentials are provided", () => {
    const result = render({
      ...VALID_INPUT,
      ga4: { measurementId: "G-XYZ", apiSecret: "SEC" },
    });
    const ga4Tag = result.config.containerVersion.tag.find(
      (t) => t.name === "Google Analytics 4",
    );
    const params = new Map<string, string | undefined>(
      ga4Tag!.parameter!.map((p) => [p.key, p.value]),
    );
    expect(params.get("enabled")).toBe("true");
    expect(params.get("measurementId")).toBe("G-XYZ");
    expect(params.get("apiSecret")).toBe("SEC");
  });

  it("substitutes the default field map into the Trackify Field Map variable", () => {
    const result = render(VALID_INPUT);
    const variable = result.config.containerVersion.variable?.find(
      (v) => v.name === "Trackify Field Map",
    );
    expect(variable).toBeDefined();
    const values = new Map<string, string | undefined>(
      variable!.parameter!.map((p) => [p.key, p.value]),
    );
    expect(values.get("journeyId")).toBe(DEFAULT_FIELD_MAP.journey_id);
    expect(values.get("visitorId")).toBe(DEFAULT_FIELD_MAP.visitor_id);
    expect(values.get("eventId")).toBe(DEFAULT_FIELD_MAP.event_id);
  });

  it("respects a custom field map override", () => {
    const result = render({
      ...VALID_INPUT,
      fieldMap: {
        ...DEFAULT_FIELD_MAP,
        journey_id: "j",
        visitor_id: "v",
      },
    });
    const variable = result.config.containerVersion.variable?.find(
      (v) => v.name === "Trackify Field Map",
    );
    const values = new Map<string, string | undefined>(
      variable!.parameter!.map((p) => [p.key, p.value]),
    );
    expect(values.get("journeyId")).toBe("j");
    expect(values.get("visitorId")).toBe("v");
  });

  it("escapes embedded quotes and backslashes in substituted values", () => {
    // A pixel id with an embedded quote must not corrupt the surrounding JSON.
    const result = render({
      ...VALID_INPUT,
      meta: { pixelId: 'pxl"quote', accessToken: "tok\\slash" },
    });
    const metaTag = result.config.containerVersion.tag.find(
      (t) => t.name === "Meta Conversions API",
    );
    const params = new Map<string, string | undefined>(
      metaTag!.parameter!.map((p) => [p.key, p.value]),
    );
    expect(params.get("pixelId")).toBe('pxl"quote');
    expect(params.get("accessToken")).toBe("tok\\slash");
  });

  it("rejects a malformed GTM container id", () => {
    expect(() =>
      render({
        ...VALID_INPUT,
        gtmContainerId: "not-a-gtm-id",
      }),
    ).toThrow();
  });

  it("rejects missing meta credentials", () => {
    expect(() =>
      render({
        gtmContainerId: "GTM-ABCDE12",
        // @ts-expect-error deliberately invalid
        meta: { pixelId: "PXL" },
      }),
    ).toThrow();
  });
});

// The Meta event-name mapping shipped in base-container.json is a runtime
// contract with what the relay's Meta CAPI adapter emits for the SAME
// CanonicalEvent. If they drift, a tenant migrated from relay-adapter
// delivery to sGTM-container delivery silently starts sending Meta a
// different event_name — the exact regression this test blocks.
describe("Meta event-name map parity with the relay adapter", () => {
  it("base-container.json's Meta Event Name Map matches EVENT_NAME_MAP in apps/relay/src/destinations/meta/payload.ts", () => {
    const raw = loadBaseTemplate();
    const parsed = JSON.parse(raw) as {
      containerVersion: {
        variable?: Array<{
          name: string;
          parameter?: Array<{ key: string; value?: string }>;
        }>;
      };
    };
    const nameMapVar = parsed.containerVersion.variable?.find(
      (v) => v.name === "Meta Event Name Map",
    );
    expect(nameMapVar).toBeDefined();
    const templateMap: Record<string, string> = {};
    for (const p of nameMapVar!.parameter ?? []) {
      if (p.value !== undefined) templateMap[p.key] = p.value;
    }

    // Extract EVENT_NAME_MAP from the relay source by reading the file — no
    // runtime import of Meta-envelope terms into this file (which lives
    // outside destinations/meta and is subject to the containment test).
    const payloadPath = join(
      REPO_ROOT,
      "apps",
      "relay",
      "src",
      "destinations",
      "meta",
      "payload.ts",
    );
    const payloadSrc = readFileSync(payloadPath, "utf8");
    const relayMap = parseEventNameMap(payloadSrc);

    expect(templateMap).toEqual(relayMap);
  });
});

// Parse `const EVENT_NAME_MAP: Record<..., string> = { key: "Value", ... };`
// out of a TypeScript source file. Kept intentionally minimal — the block is
// hand-authored in one place, so a regex is fine (and cheaper than pulling in
// a real TS parser).
function parseEventNameMap(src: string): Record<string, string> {
  const start = src.indexOf("EVENT_NAME_MAP");
  if (start < 0) throw new Error("EVENT_NAME_MAP not found in payload.ts");
  const braceOpen = src.indexOf("{", start);
  const braceClose = src.indexOf("}", braceOpen);
  if (braceOpen < 0 || braceClose < 0)
    throw new Error("could not locate EVENT_NAME_MAP body braces");
  const body = src.slice(braceOpen + 1, braceClose);
  const map: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*"([^"]+)"\s*,?\s*$/);
    if (m && m[1] && m[2]) map[m[1]] = m[2];
  }
  return map;
}
