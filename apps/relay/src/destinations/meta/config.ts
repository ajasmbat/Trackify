import { z } from "zod";

// Config for one Meta Conversions API destination. Stored on the
// `destinations` row: the sensitive half (access_token, test_event_code)
// lives in the encrypted `credentials` blob; the non-secret half
// (pixel_id, api_base_url, api_version) lives in `config`.
//
// The adapter merges them into this one shape before use — see index.ts.

export const DEFAULT_API_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_API_VERSION = "v20.0";

export const MetaConfig = z
  .object({
    pixel_id: z.string().min(1),
    access_token: z.string().min(1),
    test_event_code: z.string().min(1).optional(),
    api_base_url: z.string().url().default(DEFAULT_API_BASE_URL),
    api_version: z.string().min(1).default(DEFAULT_API_VERSION),
  })
  .strict();

export type MetaConfig = z.infer<typeof MetaConfig>;

export function metaEndpointUrl(config: MetaConfig): string {
  const base = config.api_base_url.replace(/\/+$/, "");
  return `${base}/${config.api_version}/${config.pixel_id}/events`;
}
