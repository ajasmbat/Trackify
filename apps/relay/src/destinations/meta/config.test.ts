import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
  MetaConfig,
  metaEndpointUrl,
} from "./config";

describe("MetaConfig", () => {
  it("requires pixel_id and access_token", () => {
    const missingBoth = MetaConfig.safeParse({});
    expect(missingBoth.success).toBe(false);
    if (!missingBoth.success) {
      const paths = missingBoth.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("pixel_id");
      expect(paths).toContain("access_token");
    }
  });

  it("defaults api_base_url and api_version", () => {
    const parsed = MetaConfig.parse({
      pixel_id: "123",
      access_token: "tok",
    });
    expect(parsed.api_base_url).toBe(DEFAULT_API_BASE_URL);
    expect(parsed.api_version).toBe(DEFAULT_API_VERSION);
  });

  it("accepts a test_event_code and rejects unknown keys", () => {
    const parsed = MetaConfig.parse({
      pixel_id: "123",
      access_token: "tok",
      test_event_code: "TEST42",
    });
    expect(parsed.test_event_code).toBe("TEST42");

    const bad = MetaConfig.safeParse({
      pixel_id: "1",
      access_token: "t",
      unknown_field: "x",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects an api_base_url that is not a URL", () => {
    const bad = MetaConfig.safeParse({
      pixel_id: "1",
      access_token: "t",
      api_base_url: "not a url",
    });
    expect(bad.success).toBe(false);
  });
});

describe("metaEndpointUrl", () => {
  it("composes {base}/{version}/{pixel_id}/events", () => {
    const cfg = MetaConfig.parse({ pixel_id: "999", access_token: "t" });
    expect(metaEndpointUrl(cfg)).toBe(
      "https://graph.facebook.com/v20.0/999/events",
    );
  });

  it("honours overridden base and version", () => {
    const cfg = MetaConfig.parse({
      pixel_id: "999",
      access_token: "t",
      api_base_url: "https://custom.example.com/",
      api_version: "v21.0",
    });
    expect(metaEndpointUrl(cfg)).toBe(
      "https://custom.example.com/v21.0/999/events",
    );
  });
});
