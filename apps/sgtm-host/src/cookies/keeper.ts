import { createHash } from "node:crypto";
import { encryptCredentials, decryptCredentials } from "@trackify/db";

// Cookie Keeper (T21) — Stape's headline sGTM feature, rebuilt here.
//
// Outbound: every `Set-Cookie` the container emits is rewritten to a sealed
// first-party cookie whose name is `sgtm_<12-char base32 hash of original>`
// and whose value is a libsodium-sealed `{n, v}` JSON of the original name +
// value. The rewritten cookie is HttpOnly, Secure, SameSite=None, Partitioned
// (CHIPS) and lives for 2 years — a first-party HttpOnly cookie set by the
// server survives Safari ITP's 7-day cap on JS-set cookies.
//
// Inbound: the browser sends the sealed cookies back; we decrypt each and
// forward the original name=value to the container so it sees exactly what it
// wrote. Tampered cookies (auth-tag mismatch) are silently stripped.
//
// The signing key is the shared `CREDENTIAL_KEY_HEX` libsodium secret loaded
// by `packages/db/src/crypto.ts` — the same 32-byte symmetric key used for
// destination credentials, so we get XSalsa20-Poly1305 authenticated
// encryption for free without a new key-management surface.

const PREFIX = "sgtm_";
const HASH_LEN = 12;

// 2 years — matches the doc contract; long enough to be "durable" without
// pretending we can outlive a real user session lifetime.
const MAX_AGE_SECONDS = 63072000;

// RFC 4648 base32 lowercase. Deterministic + URL-safe + case-insensitive in
// cookie contexts. Only the first HASH_LEN chars of the hash are used, so
// full alphabet purity beyond `[a-z2-7]` doesn't matter for storage but the
// determinism does — same original name → same rewritten name across every
// response, forever.
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32Lower(bytes: Buffer): string {
  let out = "";
  let value = 0;
  let bits = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function rewrittenName(originalName: string): string {
  const digest = createHash("sha256").update(originalName, "utf8").digest();
  return `${PREFIX}${base32Lower(digest).slice(0, HASH_LEN)}`;
}

export function isRewrittenName(name: string): boolean {
  return name.startsWith(PREFIX);
}

// Seal / unseal `{n, v}` using the shared credential key. `decryptCredentials`
// throws on any auth-tag failure — we treat that as tampering and return null
// so the caller can strip the cookie entirely.
async function seal(name: string, value: string): Promise<string> {
  return encryptCredentials({ n: name, v: value });
}

async function unseal(
  payload: string,
): Promise<{ n: string; v: string } | null> {
  try {
    const plain = await decryptCredentials(payload);
    if (typeof plain.n === "string" && typeof plain.v === "string") {
      return { n: plain.n, v: plain.v };
    }
    return null;
  } catch {
    return null;
  }
}

interface ParsedSetCookie {
  name: string;
  value: string;
  isDelete: boolean;
}

// Parse only what we need: the first name=value pair plus enough of the
// attributes to detect a delete (`Max-Age=0`/negative, or `Expires` in the
// past). The rest of the attributes are replaced wholesale on the rewritten
// cookie, because the browser MUST see our HttpOnly/Secure/SameSite/Partitioned
// combo regardless of what the container asked for.
function parseSetCookie(header: string): ParsedSetCookie | null {
  const parts = header.split(";").map((s) => s.trim());
  const first = parts[0];
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  const name = first.slice(0, eq).trim();
  if (!name) return null;
  const value = first.slice(eq + 1).trim();

  let isDelete = false;
  const now = Date.now();
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    if (!attr) continue;
    const kEq = attr.indexOf("=");
    const key = (kEq < 0 ? attr : attr.slice(0, kEq)).trim().toLowerCase();
    const raw = kEq < 0 ? "" : attr.slice(kEq + 1).trim();
    if (key === "max-age") {
      const n = Number(raw);
      if (Number.isFinite(n) && n <= 0) isDelete = true;
    } else if (key === "expires" && raw) {
      const t = Date.parse(raw);
      if (Number.isFinite(t) && t <= now) isDelete = true;
    }
  }

  return { name, value, isDelete };
}

function deleteHeader(rewrittenName: string): string {
  // A cookie-delete on the same name + Path=/ — matches how browsers erase
  // the cookie that was set on Path=/ (which is what we always set).
  return `${rewrittenName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`;
}

function activeHeader(rewrittenName: string, sealed: string): string {
  return `${rewrittenName}=${sealed}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`;
}

// Rewrite an ordered list of outbound `Set-Cookie` header values. Cookies
// whose original name already starts with `sgtm_` (reserved namespace) OR
// unparseable headers pass through untouched — the shim MUST be idempotent
// and MUST NOT recurse over its own writes.
export async function rewriteSetCookies(
  headers: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const header of headers) {
    const parsed = parseSetCookie(header);
    if (!parsed) {
      out.push(header);
      continue;
    }
    if (isRewrittenName(parsed.name)) {
      out.push(header);
      continue;
    }
    const newName = rewrittenName(parsed.name);
    if (parsed.isDelete) {
      out.push(deleteHeader(newName));
      continue;
    }
    const sealed = await seal(parsed.name, parsed.value);
    out.push(activeHeader(newName, sealed));
  }
  return out;
}

// Restore an inbound `Cookie` header — replace every `sgtm_<hash>=<sealed>`
// pair with the decrypted `<original_name>=<original_value>`. Non-sealed
// cookies pass through untouched; sealed cookies that fail auth are dropped.
// Returns an empty string when nothing survives, so the caller can decide
// whether to delete the header entirely.
export async function restoreCookieHeader(header: string): Promise<string> {
  const pairs = header
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      out.push(pair);
      continue;
    }
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!isRewrittenName(name)) {
      out.push(pair);
      continue;
    }
    const original = await unseal(value);
    if (!original) continue;
    out.push(`${original.n}=${original.v}`);
  }
  return out.join("; ");
}
