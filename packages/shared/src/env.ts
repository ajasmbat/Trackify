import { z, type ZodError, type ZodTypeAny } from "zod";

// Fail-at-boot env validation. When a required key is missing, throw with a
// message that names the exact key — no defaults, no silent fallbacks.
// The whole point is that a fresh clone crashes loudly on the first missing key.

export class EnvError extends Error {
  constructor(missing: string[], invalid: string[]) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (invalid.length) parts.push(`invalid: ${invalid.join(", ")}`);
    super(`Environment validation failed — ${parts.join("; ")}`);
    this.name = "EnvError";
  }
}

export function loadEnv<T extends ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  const err = parsed.error as ZodError;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      missing.push(key);
    } else {
      invalid.push(`${key} (${issue.message})`);
    }
  }
  throw new EnvError(missing, invalid);
}

// Shared building blocks — every app composes its own schema by extending the
// common core (see e.g. apps/relay/src/env.ts).
export const commonEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .optional(),
});

export const databaseEnv = z.object({
  DATABASE_URL: z.string().min(1),
});

export const credentialKeyEnv = z.object({
  // 32-byte hex string — libsodium secretbox key. See DECISIONS.md.
  CREDENTIAL_KEY_HEX: z.string().length(64, {
    message: "must be 32 bytes hex (64 chars)",
  }),
});
