import { createHash } from "node:crypto";

// PII normalisation + SHA-256. No PII flows through this ticket's app code —
// but every destination that requires hashed identifiers (Meta CAPI, Google,
// TikTok) uses this exact code path. Keep it deterministic.
//
// Never log raw PII. Callers that touch PII must log only the hashed form.

export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

// E.164 without the "+". Strips whitespace, dashes, parens, dots. Returns "" for
// obviously invalid input so callers can decide whether to drop or reject.
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashEmail(input: string): string {
  return sha256Hex(normaliseEmail(input));
}

export function hashPhone(input: string): string {
  return sha256Hex(normalisePhone(input));
}
