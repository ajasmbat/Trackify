// Browser-safe id generators. `packages/shared/journey` uses `node:crypto`
// (frozen post-Wave 0) — we can't reach into it from the client bundle, so
// this file mirrors the two shapes we need using WebCrypto.
//
//   event_id   — RFC 4122 v4 UUID (matches CanonicalEvent.event_id schema)
//   journey_id — 22-char URL-safe base64 (matches @trackify/shared/journey)

const hex = "0123456789abcdef";

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function newEventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = randomBytes(16);
  // The two version/variant bytes at RFC 4122 v4's fixed offsets. Ternaries
  // keep noUncheckedIndexedAccess happy without a non-null assertion.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const s: string[] = [];
  for (const byte of b) {
    s.push(hex[byte >>> 4] ?? "0", hex[byte & 0x0f] ?? "0");
  }
  const j = s.join("");
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20)}`;
}

export function newJourneyId(): string {
  const b = randomBytes(16);
  let bin = "";
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
