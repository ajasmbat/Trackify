import { randomBytes, randomUUID } from "node:crypto";

// A `journey_id` follows a visitor from the ad click through the storefront
// into the relay and out to every destination. T4 (ingest) and T8 (loader)
// both mint one when none exists — this is the single source of truth for how.
//
// Format: 22-char URL-safe base64 (16 bytes of entropy). Compact enough for a
// cookie value, wide enough that collision is not a concern.

export function newJourneyId(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function newEventId(): string {
  return randomUUID();
}

// A visitor_id is stable across sessions (first-party cookie in T7); this is
// the generator for the first visit.
export function newVisitorId(): string {
  return randomUUID();
}
