import type { CanonicalEvent, Identity } from "@trackify/shared";
import type { StoredIdentity } from "./store";

// Pure transform. `mergeStoredIdentity(event, stored)` returns a NEW
// CanonicalEvent whose `identity` block carries every hashed field the
// stored identity has and the inbound event did not.
//
// The rule is "inbound wins": a field the event already carries is never
// overwritten. That way if a client already has a fresher email hash on the
// event (say, from a form the visitor just filled) it stays authoritative.
//
// Never touches plaintext — the store only ever holds `*_sha256` fields,
// and this function only reads those.

export function mergeStoredIdentity(
  event: CanonicalEvent,
  stored: StoredIdentity | null,
): CanonicalEvent {
  if (!stored) return event;

  const current = event.identity ?? {};
  const next: Identity = { ...current };
  let changed = false;

  if (stored.email_sha256 && !hasEmail(current)) {
    next.email_sha256 = stored.email_sha256;
    changed = true;
  }
  if (stored.phone_sha256 && !hasPhone(current)) {
    next.phone_sha256 = stored.phone_sha256;
    changed = true;
  }
  if (stored.external_id_sha256 && !hasExternalId(current)) {
    next.external_id_sha256 = stored.external_id_sha256;
    changed = true;
  }

  if (!changed) return event;
  return { ...event, identity: next };
}

function hasEmail(id: Identity): boolean {
  return Boolean(id.email || id.email_sha256);
}

function hasPhone(id: Identity): boolean {
  return Boolean(id.phone || id.phone_sha256);
}

function hasExternalId(id: Identity): boolean {
  return Boolean(id.external_id || id.external_id_sha256);
}
