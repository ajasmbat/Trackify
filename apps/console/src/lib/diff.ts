// Compute the set of key paths present in `enriched` but NOT in `inbound`.
// Used by the event detail's "Fields added by the enricher" panel — anything
// under `server.*` (fbc, fbclid, client_ip_address, client_user_agent,
// received_at) is a good example, plus any identity.*_sha256 fields the
// enricher hashed from raw email/phone before persistence.
//
// This is a value-preserving diff: it returns the ADDED-FIELDS SUBTREE that
// mirrors the enriched object but only carries branches whose leaves are new
// or changed. It intentionally does not describe removals — the ticket asks
// for fields the enricher ADDED, not for a full JSON patch.

export function diffAdded(
  base: unknown,
  enriched: unknown,
): unknown | undefined {
  if (base === enriched) return undefined;
  if (typeof enriched !== "object" || enriched === null) {
    // Leaf: undefined in base but present in enriched (or changed).
    if (typeof base === "undefined" || !deepEqual(base, enriched)) return enriched;
    return undefined;
  }
  if (Array.isArray(enriched)) {
    // Arrays: only surface if base didn't have this array at all.
    if (!Array.isArray(base)) return enriched;
    return undefined;
  }
  const baseObj = (typeof base === "object" && base !== null && !Array.isArray(base))
    ? (base as Record<string, unknown>)
    : {};
  const out: Record<string, unknown> = {};
  let any = false;
  for (const [k, v] of Object.entries(enriched as Record<string, unknown>)) {
    const sub = diffAdded(baseObj[k], v);
    if (sub !== undefined) {
      out[k] = sub;
      any = true;
    }
  }
  return any ? out : undefined;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}
