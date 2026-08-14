import { z } from "zod";
import { loadEnv, commonEnv } from "@trackify/shared";

// Console-only env. Falls back to DATABASE_URL when CONSOLE_DATABASE_URL is
// unset — in prod you should set CONSOLE_DATABASE_URL to a read-only role
// that has SELECT on events, delivery_jobs, visitors, tenants, destinations
// but NO access to destinations.credentials_encrypted.
export const consoleEnv = commonEnv.extend({
  DATABASE_URL: z.string().min(1),
  CONSOLE_DATABASE_URL: z.string().min(1).optional(),
  CONSOLE_USERNAME: z.string().min(1),
  CONSOLE_PASSWORD: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
});

let cached: z.infer<typeof consoleEnv> | null = null;
export function env() {
  if (cached) return cached;
  cached = loadEnv(consoleEnv);
  return cached;
}

export function consoleDatabaseUrl(): string {
  const e = env();
  return e.CONSOLE_DATABASE_URL ?? e.DATABASE_URL;
}
