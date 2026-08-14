import type { CanonicalEvent } from "./events";

// The shape every destination adapter (Meta, GA4, TikTok, …) must implement.
// The relay's delivery worker does not know or care which destination it is
// talking to — that is the point.

export type SendResult =
  | { kind: "ok"; provider_message_id?: string; outbound_payload: unknown }
  | {
      kind: "permanent_failure";
      reason: string;
      status?: number;
      outbound_payload: unknown;
    }
  | {
      kind: "transient_failure";
      reason: string;
      status?: number;
      retry_after_ms?: number;
      outbound_payload: unknown;
    };

export interface Destination {
  /** Slug, matches `destinations.provider` in the DB (e.g. "meta"). */
  readonly provider: string;

  /**
   * Send one canonical event to this destination.
   *
   * MUST return `outbound_payload` on every branch — success or failure — so
   * hop 6 of the flow contract is verifiable (the exact bytes we sent to the
   * provider are persisted alongside the inbound event).
   */
  send(
    event: CanonicalEvent,
    credentials: Record<string, string>,
  ): Promise<SendResult>;
}
