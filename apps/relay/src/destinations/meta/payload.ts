import { hashEmail, hashPhone, sha256Hex } from "@trackify/shared";
import type { CanonicalEvent } from "@trackify/shared";

// Meta Conversions API payload transformer. This file is the ONLY place in the
// repo that knows Meta's field names — `data`, `event_name`, `user_data`, `em`,
// `ph`, `fn`, `ln`, `fbc`, `fbp`, `client_ip_address`, `client_user_agent`,
// `custom_data`, `content_ids`, `transaction_id`, `test_event_code`,
// `action_source`, `event_source_url`.
//
// If you find yourself writing one of those strings outside this folder, stop —
// route it through this module or extend it here.

const ACTION_SOURCE = "website" as const;

// CanonicalEvent.name → Meta standard event_name.
// Meta's list: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
const EVENT_NAME_MAP: Record<CanonicalEvent["name"], string> = {
  page_view: "PageView",
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  user_identified: "CompleteRegistration",
  purchase: "Purchase",
};

export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  fbc?: string;
  fbp?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

export interface MetaCustomData {
  value?: number;
  currency?: string;
  content_ids?: string[];
  transaction_id?: string;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: typeof ACTION_SOURCE;
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: MetaCustomData;
}

export interface MetaRequestBody {
  data: [MetaEvent];
  test_event_code?: string;
}

export interface BuildPayloadInput {
  event: CanonicalEvent;
  test_event_code?: string;
}

/**
 * Build the exact JSON body we POST to Meta.
 *
 * Hashing rule: any identifier that lands in `em`/`ph`/`fn`/`ln` is
 * SHA-256'd here. Callers may pass pre-hashed values via `identity.*_sha256`;
 * plaintext in `identity.email` / `identity.phone` is normalised + hashed
 * before it is written into `user_data`.
 */
export function buildMetaRequestBody(input: BuildPayloadInput): MetaRequestBody {
  const { event, test_event_code } = input;

  const userData = buildUserData(event);
  const customData = buildCustomData(event);

  const metaEvent: MetaEvent = {
    event_name: EVENT_NAME_MAP[event.name],
    event_time: Math.floor(new Date(event.ts).getTime() / 1000),
    event_id: event.event_id,
    action_source: ACTION_SOURCE,
    user_data: userData,
  };

  if (event.context?.url) metaEvent.event_source_url = event.context.url;
  if (customData) metaEvent.custom_data = customData;

  const body: MetaRequestBody = { data: [metaEvent] };
  if (test_event_code) body.test_event_code = test_event_code;
  return body;
}

function buildUserData(event: CanonicalEvent): MetaUserData {
  const userData: MetaUserData = {};
  const identity = event.identity;

  if (identity) {
    const emailHash = pickHashed(identity.email_sha256, identity.email, hashEmail);
    if (emailHash) userData.em = [emailHash];

    const phoneHash = pickHashed(identity.phone_sha256, identity.phone, hashPhone);
    if (phoneHash) userData.ph = [phoneHash];

    // No first/last name fields on the shared Identity yet; when they arrive
    // they route through pickHashed() with a normaliser and land in fn/ln.
    const externalHash = pickHashed(
      identity.external_id_sha256,
      identity.external_id,
      sha256Hex,
    );
    // external_id is not em/ph — Meta uses `external_id` in user_data too, but
    // that field isn't in the acceptance shape for this ticket; leaving off.
    void externalHash;
  }

  if (event.context?.ip) userData.client_ip_address = event.context.ip;
  if (event.context?.user_agent)
    userData.client_user_agent = event.context.user_agent;

  return userData;
}

function pickHashed(
  preHashed: string | undefined,
  plaintext: string | undefined,
  hasher: (s: string) => string,
): string | undefined {
  if (preHashed) return preHashed;
  if (plaintext) return hasher(plaintext);
  return undefined;
}

function buildCustomData(event: CanonicalEvent): MetaCustomData | undefined {
  switch (event.name) {
    case "view_item":
    case "add_to_cart": {
      const item = event.props.item;
      return {
        value: centsToUnits(item.price_cents),
        currency: item.currency,
        content_ids: [item.sku],
      };
    }
    case "begin_checkout": {
      return {
        value: centsToUnits(event.props.value_cents),
        currency: event.props.currency,
        content_ids: event.props.items.map((i) => i.sku),
      };
    }
    case "purchase": {
      return {
        value: centsToUnits(event.props.value_cents),
        currency: event.props.currency,
        content_ids: event.props.items.map((i) => i.sku),
        transaction_id: event.props.order_id,
      };
    }
    case "page_view":
    case "user_identified":
      return undefined;
  }
}

function centsToUnits(cents: number): number {
  return Math.round(cents) / 100;
}
