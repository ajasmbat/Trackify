import { randomBytes } from "node:crypto";

// Opaque server-issued visitor id. 24 bytes of CSPRNG entropy → 32 URL-safe
// base64 characters — wide enough that collision is not a real concern for a
// long-lived first-party cookie, and short enough to sit comfortably in a
// header. Kept opaque so nothing about the visitor (tenant, timestamp) leaks
// through the cookie value.
export function newRelayVisitorId(): string {
  return randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
