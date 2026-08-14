// Canonical field names on `CanonicalEvent`. Kept as string constants (not
// magic strings inline in the template) so a rename in @trackify/shared/events
// flows to the sGTM container config through render() rather than a silent
// mismatch inside the tag's runtime code.
//
// Any rename here MUST be paired with the corresponding rename in
// packages/shared/src/events.ts — the parity test asserts round-trip equality.
export interface CanonicalFieldMap {
  event_id: string;
  event_name: string;
  journey_id: string;
  visitor_id: string;
  tenant_id: string;
  ts: string;
  identity: string;
  context: string;
  props: string;
}

export const DEFAULT_FIELD_MAP: CanonicalFieldMap = {
  event_id: "event_id",
  event_name: "name",
  journey_id: "journey_id",
  visitor_id: "visitor_id",
  tenant_id: "tenant_id",
  ts: "ts",
  identity: "identity",
  context: "context",
  props: "props",
};
