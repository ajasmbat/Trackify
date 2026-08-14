import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ContainerConfig } from "./schema";
import { DEFAULT_FIELD_MAP, type CanonicalFieldMap } from "./field-map";

// Per-tenant substitutions the base template expects. The Meta half is
// required for the acceptance target (a Meta CAPI tag with real pixel id +
// access token substituted from the tenant's decrypted destinations row);
// the GA4 half is optional so tenants without GA4 credentials still render a
// bootable container (the GA4 tag is included but disabled).
export const RenderInput = z
  .object({
    gtmContainerId: z
      .string()
      .regex(/^GTM-[A-Z0-9]+$/, "expected a GTM-XXXXX container id"),
    meta: z
      .object({
        pixelId: z.string().min(1),
        accessToken: z.string().min(1),
        testEventCode: z.string().min(1).optional(),
      })
      .strict(),
    ga4: z
      .object({
        measurementId: z.string().min(1),
        apiSecret: z.string().min(1),
      })
      .strict()
      .optional(),
    fieldMap: z
      .object({
        event_id: z.string().min(1),
        event_name: z.string().min(1),
        journey_id: z.string().min(1),
        visitor_id: z.string().min(1),
        tenant_id: z.string().min(1),
        ts: z.string().min(1),
        identity: z.string().min(1),
        context: z.string().min(1),
        props: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RenderInput = z.input<typeof RenderInput>;

const here = dirname(fileURLToPath(import.meta.url));
// Read the raw JSON so placeholder tokens survive the round trip — importing
// with `resolveJsonModule` would parse first (fine here, but the string form
// keeps the substitution step obvious and testable).
const RAW_TEMPLATE = readFileSync(join(here, "base-container.json"), "utf8");

export function loadBaseTemplate(): string {
  return RAW_TEMPLATE;
}

// Every {{TOKEN}} the base template contains. Enumerated here (not derived
// from a regex) so a stray token in the JSON fails validation loudly instead
// of silently rendering with an empty string.
const PLACEHOLDER_KEYS = [
  "GTM_CONTAINER_ID",
  "PIXEL_ID",
  "ACCESS_TOKEN",
  "TEST_EVENT_CODE",
  "MEASUREMENT_ID",
  "GA4_API_SECRET",
  "GA4_ENABLED",
  "FIELD_EVENT_ID",
  "FIELD_EVENT_NAME",
  "FIELD_JOURNEY_ID",
  "FIELD_VISITOR_ID",
  "FIELD_TENANT_ID",
  "FIELD_TS",
  "FIELD_IDENTITY",
  "FIELD_CONTEXT",
  "FIELD_PROPS",
] as const;
type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

function buildSubstitutions(
  input: RenderInput,
  fieldMap: CanonicalFieldMap,
): Record<PlaceholderKey, string> {
  const ga4 = input.ga4;
  return {
    GTM_CONTAINER_ID: input.gtmContainerId,
    PIXEL_ID: input.meta.pixelId,
    ACCESS_TOKEN: input.meta.accessToken,
    TEST_EVENT_CODE: input.meta.testEventCode ?? "",
    MEASUREMENT_ID: ga4?.measurementId ?? "",
    GA4_API_SECRET: ga4?.apiSecret ?? "",
    GA4_ENABLED: ga4 ? "true" : "false",
    FIELD_EVENT_ID: fieldMap.event_id,
    FIELD_EVENT_NAME: fieldMap.event_name,
    FIELD_JOURNEY_ID: fieldMap.journey_id,
    FIELD_VISITOR_ID: fieldMap.visitor_id,
    FIELD_TENANT_ID: fieldMap.tenant_id,
    FIELD_TS: fieldMap.ts,
    FIELD_IDENTITY: fieldMap.identity,
    FIELD_CONTEXT: fieldMap.context,
    FIELD_PROPS: fieldMap.props,
  };
}

function substitute(
  raw: string,
  values: Record<PlaceholderKey, string>,
): string {
  return raw.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) {
      throw new Error(
        `unknown placeholder {{${key}}} in base-container.json — add it to PLACEHOLDER_KEYS + buildSubstitutions() or remove it from the template`,
      );
    }
    // Values land inside JSON string positions. Escape backslashes + quotes
    // + control chars so a token that happens to contain one doesn't corrupt
    // the enclosing string.
    return values[key as PlaceholderKey]
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  });
}

export interface RenderResult {
  json: string;
  base64: string;
  config: ContainerConfig;
}

/**
 * Render the base template with tenant-specific substitutions and return the
 * JSON string, its base64 encoding (for `CONTAINER_CONFIG=`), and the parsed
 * config for round-trip verification.
 *
 * Throws on unknown placeholders, on invalid input, or if the rendered JSON
 * fails schema validation — the point is to catch template drift at render
 * time, not to hand a broken blob to Docker.
 */
export function render(input: RenderInput): RenderResult {
  const parsedInput = RenderInput.parse(input);
  const fieldMap = parsedInput.fieldMap ?? DEFAULT_FIELD_MAP;
  const values = buildSubstitutions(parsedInput, fieldMap);
  const rendered = substitute(RAW_TEMPLATE, values);
  const parsed: unknown = JSON.parse(rendered);
  const config = ContainerConfig.parse(parsed);
  const json = JSON.stringify(config);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return { json, base64, config };
}
