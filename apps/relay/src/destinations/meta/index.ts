import { logger } from "@trackify/shared";
import type { CanonicalEvent, Destination, SendResult } from "@trackify/shared";
import { MetaConfig, metaEndpointUrl } from "./config";
import type { MetaHttpClient } from "./http";
import { defaultMetaHttpClient } from "./http";
import { buildMetaRequestBody } from "./payload";
import { mapMetaResponse, mapMetaThrown } from "./response";

// The Destination implementation the queue picks up via registry.ts at boot.
//
// The queue passes the encrypted-then-decrypted `credentials` record from the
// `destinations` row. We validate it with Zod (config.ts) and then run the
// adapter: build payload → POST → map response. `outbound_payload` is stapled
// on every result so hop 6 of the flow contract is verifiable end-to-end.

export interface MetaDestinationOptions {
  http?: MetaHttpClient;
}

export function createMetaDestination(
  options: MetaDestinationOptions = {},
): Destination {
  const http = options.http ?? defaultMetaHttpClient;
  return {
    provider: "meta",
    async send(event, credentials) {
      return sendOne(event, credentials, http);
    },
  };
}

export const metaDestination: Destination = createMetaDestination();

async function sendOne(
  event: CanonicalEvent,
  credentials: Record<string, string>,
  http: MetaHttpClient,
): Promise<SendResult> {
  const parsed = MetaConfig.safeParse(credentials);
  if (!parsed.success) {
    const reason = `invalid_meta_config: ${parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`;
    return {
      kind: "permanent_failure",
      reason,
      outbound_payload: null,
    };
  }
  const config = parsed.data;

  const body = buildMetaRequestBody({
    event,
    test_event_code: config.test_event_code,
  });

  const url = withAccessToken(metaEndpointUrl(config), config.access_token);

  try {
    const res = await http({ url, body });
    return mapMetaResponse(res, body);
  } catch (err) {
    return mapMetaThrown(err, body);
  }
}

function withAccessToken(url: string, accessToken: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}access_token=${encodeURIComponent(accessToken)}`;
}

/**
 * Boot-time guardrail. Call once at startup with every Meta destination's
 * (decrypted) credentials — logs a loud warning if any of them ship a
 * `test_event_code` while `NODE_ENV=production`.
 *
 * Returns the number of misconfigured destinations so the caller can decide
 * whether to fail hard. Never throws.
 */
export function warnIfTestEventInProduction(
  destinations: ReadonlyArray<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (env.NODE_ENV !== "production") return 0;

  let count = 0;
  for (const creds of destinations) {
    if (creds.test_event_code && creds.test_event_code.length > 0) {
      count += 1;
      logger().warn(
        {
          code: "meta_test_event_in_prod",
          pixel_id: creds.pixel_id ?? null,
        },
        "meta destination has test_event_code set in production",
      );
    }
  }
  return count;
}

export { MetaConfig } from "./config";
export type { MetaHttpClient, MetaHttpResponse } from "./http";
export { MetaHttpNetworkError } from "./http";
